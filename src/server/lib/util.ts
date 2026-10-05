import cfg from '../../config';

export interface Point {
    x: number;
    y: number;
}

export interface PositionWithRadius extends Point {
    radius: number;
}

export interface Identifiable {
    id: string;
}

export function validNick(nickname: string): boolean {
    const regex = /^\w*$/;
    return regex.exec(nickname) !== null;
}

// Radius of a circle given its mass.
export function massToRadius(mass: number): number {
    return 4 + Math.sqrt(mass) * 6;
}

// Logarithm with configurable base.
export function mathLog(n: number, base?: number): number {
    return Math.log(n) / (base ? Math.log(base) : 1);
}

// Euclidean distance between the edges of two shapes.
export function getDistance(p1: PositionWithRadius, p2: PositionWithRadius): number {
    return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2)) - p1.radius - p2.radius;
}

export function randomInRange(from: number, to: number): number {
    return Math.floor(Math.random() * (to - from)) + from;
}

// Random position within the field of play. Returned object has no radius
// field; callers that need one (e.g. uniformPosition) attach it themselves.
export function randomPosition(radius: number): Point {
    return {
        x: randomInRange(radius, cfg.gameWidth - radius),
        y: randomInRange(radius, cfg.gameHeight - radius)
    };
}

export function uniformPosition(points: PositionWithRadius[], radius: number): Point {
    let bestCandidate: PositionWithRadius | undefined;
    let maxDistance = 0;
    const numberOfCandidates = 10;

    if (points.length === 0) {
        return randomPosition(radius);
    }

    for (let ci = 0; ci < numberOfCandidates; ci++) {
        let minDistance = Infinity;
        const candidate: PositionWithRadius = { ...randomPosition(radius), radius };

        for (let pi = 0; pi < points.length; pi++) {
            const distance = getDistance(candidate, points[pi]);
            if (distance < minDistance) {
                minDistance = distance;
            }
        }

        if (minDistance > maxDistance) {
            bestCandidate = candidate;
            maxDistance = minDistance;
        } else {
            return randomPosition(radius);
        }
    }

    return bestCandidate as PositionWithRadius;
}

export function findIndex(arr: Identifiable[], id: string): number {
    let len = arr.length;
    while (len--) {
        if (arr[len].id === id) {
            return len;
        }
    }
    return -1;
}

export function randomColor(): { fill: string; border: string } {
    const color = '#' + ('00000' + (Math.random() * (1 << 24) | 0).toString(16)).slice(-6);
    const c = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(color) as RegExpExecArray;
    const r = (parseInt(c[1], 16) - 32) > 0 ? (parseInt(c[1], 16) - 32) : 0;
    const g = (parseInt(c[2], 16) - 32) > 0 ? (parseInt(c[2], 16) - 32) : 0;
    const b = (parseInt(c[3], 16) - 32) > 0 ? (parseInt(c[3], 16) - 32) : 0;

    return {
        fill: color,
        border: '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)
    };
}

export function removeNulls<T>(inputArray: Array<T | null>): T[] {
    const result: T[] = [];
    for (const element of inputArray) {
        if (element != null) {
            result.push(element);
        }
    }
    return result;
}

// Removes elements from inputArray whose indexes are in the indexes array.
// Mutates the input (writes nulls in-place) then returns a compacted copy.
export function removeIndexes<T>(inputArray: T[], indexes: number[]): T[] {
    const nullified = inputArray as Array<T | null>;
    for (const index of indexes) {
        nullified[index] = null;
    }
    return removeNulls(nullified);
}

// Rectangle-rectangle collision. width/height are half-extents.
export function testRectangleRectangle(
    centerXA: number, centerYA: number, widthA: number, heightA: number,
    centerXB: number, centerYB: number, widthB: number, heightB: number
): boolean {
    return centerXA + widthA > centerXB - widthB
        && centerXA - widthA < centerXB + widthB
        && centerYA + heightA > centerYB - heightB
        && centerYA - heightA < centerYB + heightB;
}

// Square-rectangle collision. edgeLength/width/height are half-extents.
export function testSquareRectangle(
    centerXA: number, centerYA: number, edgeLengthA: number,
    centerXB: number, centerYB: number, widthB: number, heightB: number
): boolean {
    return testRectangleRectangle(
        centerXA, centerYA, edgeLengthA, edgeLengthA,
        centerXB, centerYB, widthB, heightB);
}

export function getIndexes<T>(array: T[], predicate: (value: T) => boolean): number[] {
    return array.reduce<number[]>((acc, value, index) => {
        if (predicate(value)) {
            acc.push(index);
        }
        return acc;
    }, []);
}

// Preserve CommonJS consumers (still-JS modules that do
// `const util = require('./lib/util')` and then `util.something`).
module.exports = {
    validNick,
    massToRadius,
    mathLog,
    getDistance,
    randomInRange,
    randomPosition,
    uniformPosition,
    findIndex,
    randomColor,
    removeNulls,
    removeIndexes,
    testRectangleRectangle,
    testSquareRectangle,
    getIndexes
};
