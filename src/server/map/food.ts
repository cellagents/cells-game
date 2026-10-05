import * as util from '../lib/util';
import { v4 as uuidv4 } from 'uuid';
import { getPosition } from '../lib/entityUtils';
import type { Point } from '../lib/util';

class Food {
    id: string;
    x: number;
    y: number;
    radius: number;
    mass: number;
    hue: number;

    constructor(position: Point, radius: number) {
        this.id = uuidv4();
        this.x = position.x;
        this.y = position.y;
        this.radius = radius;
        this.mass = Math.random() + 2;
        this.hue = Math.round(Math.random() * 360);
    }
}

export class FoodManager {
    data: Food[];
    foodMass: number;
    foodUniformDisposition: boolean;

    constructor(foodMass: number, foodUniformDisposition: boolean) {
        this.data = [];
        this.foodMass = foodMass;
        this.foodUniformDisposition = foodUniformDisposition;
    }

    addNew(number: number): void {
        const radius = util.massToRadius(this.foodMass);
        while (number--) {
            const position = getPosition(this.foodUniformDisposition, radius, this.data);
            this.data.push(new Food(position, radius));
        }
    }

    removeExcess(number: number): void {
        while (number-- && this.data.length) {
            this.data.pop();
        }
    }

    delete(foodsToDelete: number[]): void {
        if (foodsToDelete.length > 0) {
            this.data = util.removeIndexes(this.data, foodsToDelete);
        }
    }
}

module.exports = { FoodManager };
