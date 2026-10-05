import * as util from '../lib/util';
import { v4 as uuidv4 } from 'uuid';
import { getPosition } from '../lib/entityUtils';
import type { Point } from '../lib/util';
import type { VirusConfig } from '../../config';

class Virus {
    id: string;
    x: number;
    y: number;
    radius: number;
    mass: number;
    fill: string;
    stroke: string;
    strokeWidth: number;

    constructor(position: Point, radius: number, mass: number, config: VirusConfig) {
        this.id = uuidv4();
        this.x = position.x;
        this.y = position.y;
        this.radius = radius;
        this.mass = mass;
        this.fill = config.fill;
        this.stroke = config.stroke;
        this.strokeWidth = config.strokeWidth;
    }
}

export class VirusManager {
    data: Virus[];
    virusConfig: VirusConfig;

    constructor(virusConfig: VirusConfig) {
        this.data = [];
        this.virusConfig = virusConfig;
    }

    pushNew(virus: Virus): void {
        this.data.push(virus);
    }

    addNew(number: number): void {
        while (number--) {
            const mass = util.randomInRange(this.virusConfig.defaultMass.from, this.virusConfig.defaultMass.to);
            const radius = util.massToRadius(mass);
            const position = getPosition(this.virusConfig.uniformDisposition, radius, this.data);
            const newVirus = new Virus(position, radius, mass, this.virusConfig);
            this.pushNew(newVirus);
        }
    }

    // NOTE: original code accepts an index number here even though the parameter
    // is named 'virusCollision'. Preserved as-is; see TODO.md.
    delete(virusCollision: number): void {
        this.data.splice(virusCollision, 1);
    }
}

module.exports = { VirusManager };
