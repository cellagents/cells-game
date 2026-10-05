import * as util from '../lib/util';
import * as gameLogic from '../game-logic';
import * as sat from 'sat';

interface FiringPlayer {
    id: string;
    x: number;
    y: number;
    hue: number;
    target: { x: number; y: number };
    cells: Array<{ x: number; y: number }>;
}

export class MassFood {
    id: string;
    num: number;
    mass: number;
    hue: number;
    direction: sat.Vector;
    x: number;
    y: number;
    radius: number;
    speed: number;

    constructor(playerFiring: FiringPlayer, cellIndex: number, mass: number) {
        this.id = playerFiring.id;
        this.num = cellIndex;
        this.mass = mass;
        this.hue = playerFiring.hue;
        this.direction = new sat.Vector(
            playerFiring.x - playerFiring.cells[cellIndex].x + playerFiring.target.x,
            playerFiring.y - playerFiring.cells[cellIndex].y + playerFiring.target.y
        ).normalize();
        this.x = playerFiring.cells[cellIndex].x;
        this.y = playerFiring.cells[cellIndex].y;
        this.radius = util.massToRadius(mass);
        this.speed = 25;
    }

    move(gameWidth: number, gameHeight: number): void {
        const deltaX = this.speed * this.direction.x;
        const deltaY = this.speed * this.direction.y;

        this.speed -= 0.5;
        if (this.speed < 0) {
            this.speed = 0;
        }
        if (!isNaN(deltaY)) {
            this.y += deltaY;
        }
        if (!isNaN(deltaX)) {
            this.x += deltaX;
        }

        gameLogic.adjustForBoundaries(this, this.radius, 5, gameWidth, gameHeight);
    }
}

export class MassFoodManager {
    data: MassFood[];

    constructor() {
        this.data = [];
    }

    addNew(playerFiring: FiringPlayer, cellIndex: number, mass: number): void {
        this.data.push(new MassFood(playerFiring, cellIndex, mass));
    }

    move(gameWidth: number, gameHeight: number): void {
        for (const currentFood of this.data) {
            if (currentFood.speed > 0) currentFood.move(gameWidth, gameHeight);
        }
    }

    remove(indexes: number[]): void {
        if (indexes.length > 0) {
            this.data = util.removeIndexes(this.data, indexes);
        }
    }
}

module.exports = { MassFood, MassFoodManager };
