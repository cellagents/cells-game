import * as foodUtils from './food';
import * as virusUtils from './virus';
import * as massFoodUtils from './massFood';
import * as playerUtils from './player';
import type { Config } from '../../config';

export { foodUtils, virusUtils, massFoodUtils, playerUtils };

export class Map {
    food: foodUtils.FoodManager;
    viruses: virusUtils.VirusManager;
    massFood: massFoodUtils.MassFoodManager;
    players: playerUtils.PlayerManager;

    constructor(config: Config) {
        this.food = new foodUtils.FoodManager(config.game.foodMass, config.game.foodUniformDisposition);
        this.viruses = new virusUtils.VirusManager(config.game.virus);
        this.massFood = new massFoodUtils.MassFoodManager();
        this.players = new playerUtils.PlayerManager();
    }

    balanceMass(foodMass: number, gameMass: number, maxFood: number, maxVirus: number): void {
        const totalMass = this.food.data.length * foodMass + this.players.getTotalMass();

        const massDiff = gameMass - totalMass;
        const foodFreeCapacity = maxFood - this.food.data.length;
        const foodDiff = Math.min(parseInt(String(massDiff / foodMass)), foodFreeCapacity);
        if (foodDiff > 0) {
            console.debug('[DEBUG] Adding ' + foodDiff + ' food');
            this.food.addNew(foodDiff);
        } else if (foodDiff && foodFreeCapacity !== maxFood) {
            console.debug('[DEBUG] Removing ' + -foodDiff + ' food');
            this.food.removeExcess(-foodDiff);
        }

        const virusesToAdd = maxVirus - this.viruses.data.length;
        if (virusesToAdd > 0) {
            this.viruses.addNew(virusesToAdd);
        }
    }

}

module.exports = {
    foodUtils,
    virusUtils,
    massFoodUtils,
    playerUtils,
    Map
};
