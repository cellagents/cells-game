import { isVisibleEntity } from '../lib/entityUtils';
import * as foodUtils from './food';
import * as virusUtils from './virus';
import * as massFoodUtils from './massFood';
import * as playerUtils from './player';
import type { Config } from '../../config';
import type { Player } from './player';

export { foodUtils, virusUtils, massFoodUtils, playerUtils };

interface PlayerSnapshot {
    x: number;
    y: number;
    cells: unknown[];
    massTotal: number;
    hue: number;
    id: string;
    name: string | null;
}

type EnumerateCallback = (
    playerData: PlayerSnapshot,
    visiblePlayers: PlayerSnapshot[],
    visibleFood: unknown[],
    visibleMass: unknown[],
    visibleViruses: unknown[]
) => void;

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

    enumerateWhatPlayersSee(callback: EnumerateCallback): void {
        for (const currentPlayer of this.players.data) {
            const visibleFood = this.food.data.filter(entity => isVisibleEntity(entity, currentPlayer as unknown as import('../lib/entityUtils').Viewer, false));
            const visibleViruses = this.viruses.data.filter(entity => isVisibleEntity(entity, currentPlayer as unknown as import('../lib/entityUtils').Viewer));
            const visibleMass = this.massFood.data.filter(entity => isVisibleEntity(entity, currentPlayer as unknown as import('../lib/entityUtils').Viewer));

            const extractData = (player: Player): PlayerSnapshot => {
                return {
                    x: player.x,
                    y: player.y,
                    cells: player.cells,
                    massTotal: Math.round(player.massTotal),
                    hue: player.hue,
                    id: player.id,
                    name: player.name
                };
            };

            const visiblePlayers: PlayerSnapshot[] = [];
            for (const player of this.players.data) {
                for (const cell of player.cells) {
                    if (isVisibleEntity(cell, currentPlayer as unknown as import('../lib/entityUtils').Viewer)) {
                        visiblePlayers.push(extractData(player));
                        break;
                    }
                }
            }

            callback(extractData(currentPlayer), visiblePlayers, visibleFood, visibleMass, visibleViruses);
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
