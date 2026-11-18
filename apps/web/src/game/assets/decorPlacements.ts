import type { OfficeDecor } from '@office/protocol';
import type { FurniturePlacement } from './loadFurniture';

/**
 * T-1158: decor entries as standalone furniture placements, so repeated models share one
 * InstancedMesh per part and small items stop casting shadows (`SHADOW_MIN_VOLUME`).
 */
export function decorPlacements(decor: OfficeDecor): FurniturePlacement[] {
  return decor.items.map((item) => ({
    box: { id: item.id, type: 'decor', position: item.position, size: item.size, rotY: item.rotY },
    file: item.model,
    rotY: item.rotY,
    standalone: true,
    ...(item.replaces ? { replaces: item.replaces } : {}),
  }));
}
