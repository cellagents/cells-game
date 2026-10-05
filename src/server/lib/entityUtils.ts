import * as util from './util';
import type { Point, PositionWithRadius } from './util';

export function getPosition(
    isUniform: boolean,
    radius: number,
    uniformPositions: PositionWithRadius[]
): Point {
    return isUniform ? util.uniformPosition(uniformPositions, radius) : util.randomPosition(radius);
}

export interface ViewportEntity extends Point {
    radius: number;
}

export interface Viewer extends Point {
    screenWidth: number;
    screenHeight: number;
}

export function isVisibleEntity(entity: ViewportEntity, player: Viewer, addThreshold = true): boolean {
    const entityHalfSize = entity.radius + (addThreshold ? entity.radius * 0.1 : 0);
    return util.testRectangleRectangle(
        entity.x, entity.y, entityHalfSize, entityHalfSize,
        player.x, player.y, player.screenWidth / 2, player.screenHeight / 2);
}

module.exports = {
    getPosition,
    isVisibleEntity
};
