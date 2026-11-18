import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { EMOTES, type EmoteId } from '@office/protocol';
import { EMOTE_UI, EmoteMenu, EmoteMenuList } from '../src/ui/EmoteMenu';

// T-1222 (REQ-AVATAR-004): component test without a DOM. The list is a stateless component,
// so its element tree is inspected directly and its handlers are called like React would.

type Props = {
  children?: ReactNode;
  onClick?: () => void;
  onKeyDown?: (e: { key: string; preventDefault(): void; stopPropagation(): void }) => void;
  disabled?: boolean;
  'data-emote'?: EmoteId;
};

/** Every element in a rendered tree, depth first. */
function elements(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Props>(node)) return [];
  return [node, ...elements(node.props.children)];
}

function render(allowed: (e: EmoteId) => boolean = () => true) {
  const onPick = vi.fn<(e: EmoteId) => void>();
  const onClose = vi.fn();
  const tree = EmoteMenuList({ allowed, onPick, onClose });
  const buttons = elements(tree).filter((el) => el.type === 'button');
  return { tree: tree as ReactElement<Props>, buttons, onPick, onClose };
}

const key = (k: string) => ({ key: k, preventDefault: vi.fn(), stopPropagation: vi.fn() });

describe('EmoteMenu (T-1222)', () => {
  it('lists every emote from the protocol list with an icon and a label', () => {
    const { buttons } = render();
    expect(buttons.map((b) => b.props['data-emote'])).toEqual([...EMOTES]);
    const html = renderToStaticMarkup(
      EmoteMenuList({ allowed: () => true, onPick: () => {}, onClose: () => {} }),
    );
    for (const id of EMOTES) {
      expect(html).toContain(EMOTE_UI[id].label);
      expect(html).toContain(EMOTE_UI[id].icon);
    }
    expect(html).toContain('aria-label="Emotes"');
    // Icons are decorative; the accessible name is the label.
    expect(html.match(/aria-hidden="true"/g)).toHaveLength(EMOTES.length);
  });

  it('sends the matching emote on click', () => {
    for (const id of EMOTES) {
      const { buttons, onPick, onClose } = render();
      buttons.find((b) => b.props['data-emote'] === id)!.props.onClick!();
      expect(onPick).toHaveBeenCalledExactlyOnceWith(id);
      expect(onClose).not.toHaveBeenCalled();
    }
  });

  it('closes on Escape and ignores other keys', () => {
    const { tree, onClose, onPick } = render();
    tree.props.onKeyDown!(key('Enter'));
    expect(onClose).not.toHaveBeenCalled();
    const esc = key('Escape');
    tree.props.onKeyDown!(esc);
    expect(onClose).toHaveBeenCalledOnce();
    expect(esc.preventDefault).toHaveBeenCalled();
    expect(onPick).not.toHaveBeenCalled();
  });

  it('disables emotes the current activity does not allow', () => {
    const { buttons } = render((e) => e !== 'dance');
    const disabled = buttons.filter((b) => b.props.disabled).map((b) => b.props['data-emote']);
    expect(disabled).toEqual(['dance']);
  });

  it('renders closed with a toggle and the G key hint', () => {
    const html = renderToStaticMarkup(
      <EmoteMenu allowed={() => true} onEmote={() => {}} onDone={() => {}} />,
    );
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls="emote-menu"');
    expect(html).toContain('Emotes');
    expect(html).toContain('G — Wave');
    expect(html).not.toContain('data-emote');
  });
});
