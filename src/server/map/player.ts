import * as util from '../lib/util';
import * as sat from 'sat';
import * as gameLogic from '../game-logic';

const MIN_SPEED = 6.25;
const SPLIT_CELL_SPEED = 20;
const SPEED_DECREMENT = 0.5;
const MIN_DISTANCE = 50;
const PUSHING_AWAY_SPEED = 1.1;
const MERGE_TIMER = 15;

export interface Target { x: number; y: number; }
export interface Position { x: number; y: number; }

class Cell {
    x: number;
    y: number;
    mass: number;
    radius: number;
    speed: number;

    constructor(x: number, y: number, mass: number, speed: number) {
        this.x = x;
        this.y = y;
        this.mass = mass;
        this.radius = util.massToRadius(mass);
        this.speed = speed;
    }

    setMass(mass: number): void {
        this.mass = mass;
        this.recalculateRadius();
    }

    addMass(mass: number): void {
        this.setMass(this.mass + mass);
    }

    recalculateRadius(): void {
        this.radius = util.massToRadius(this.mass);
    }

    toCircle(): sat.Circle {
        return new sat.Circle(new sat.Vector(this.x, this.y), this.radius);
    }

    move(playerX: number, playerY: number, playerTarget: Target, slowBase: number, initMassLog: number): void {
        const target = {
            x: playerX - this.x + playerTarget.x,
            y: playerY - this.y + playerTarget.y
        };
        const dist = Math.hypot(target.y, target.x);
        const deg = Math.atan2(target.y, target.x);
        let slowDown = 1;
        if (this.speed <= MIN_SPEED) {
            slowDown = util.mathLog(this.mass, slowBase) - initMassLog + 1;
        }

        let deltaY = this.speed * Math.sin(deg) / slowDown;
        let deltaX = this.speed * Math.cos(deg) / slowDown;

        if (this.speed > MIN_SPEED) {
            this.speed -= SPEED_DECREMENT;
        }
        if (dist < (MIN_DISTANCE + this.radius)) {
            deltaY *= dist / (MIN_DISTANCE + this.radius);
            deltaX *= dist / (MIN_DISTANCE + this.radius);
        }

        if (!isNaN(deltaY)) {
            this.y += deltaY;
        }
        if (!isNaN(deltaX)) {
            this.x += deltaX;
        }
    }

    // Return codes:
    //   0: nothing happened
    //   1: A ate B
    //   2: B ate A
    static checkWhoAteWho(cellA: Cell | null, cellB: Cell | null): number {
        if (!cellA || !cellB) return 0;
        const response = new sat.Response();
        const colliding = sat.testCircleCircle(cellA.toCircle(), cellB.toCircle(), response);
        if (!colliding) return 0;
        if (response.bInA) return 1;
        if (response.aInB) return 2;
        return 0;
    }
}

interface ClientProvidedData {
    name: string;
    screenWidth: number;
    screenHeight: number;
}

type CollisionCallback = (
    gotEaten: { playerIndex: number; cellIndex: number },
    eater: { playerIndex: number; cellIndex: number }
) => void;

export class Player {
    id: string;
    hue: number;
    name: string | null;
    screenWidth: number | null;
    screenHeight: number | null;
    timeToMerge: number | null;
    lastHeartbeat!: number;
    ipAddress?: string;
    cells!: Cell[];
    massTotal!: number;
    x!: number;
    y!: number;
    target!: Target;

    constructor(id: string) {
        this.id = id;
        this.hue = Math.round(Math.random() * 360);
        this.name = null;
        this.screenWidth = null;
        this.screenHeight = null;
        this.timeToMerge = null;
        this.setLastHeartbeat();
    }

    // Initializes things that change with every respawn.
    init(position: Position, defaultPlayerMass: number): void {
        this.cells = [new Cell(position.x, position.y, defaultPlayerMass, MIN_SPEED)];
        this.massTotal = defaultPlayerMass;
        this.x = position.x;
        this.y = position.y;
        this.target = { x: 0, y: 0 };
    }

    clientProvidedData(playerData: ClientProvidedData): void {
        this.name = playerData.name;
        this.screenWidth = playerData.screenWidth;
        this.screenHeight = playerData.screenHeight;
        this.setLastHeartbeat();
    }

    setLastHeartbeat(): void {
        this.lastHeartbeat = Date.now();
    }

    setLastSplit(): void {
        this.timeToMerge = Date.now() + 1000 * MERGE_TIMER;
    }

    loseMassIfNeeded(massLossRate: number, defaultPlayerMass: number, minMassLoss: number): void {
        for (const i in this.cells) {
            if (this.cells[i].mass * (1 - (massLossRate / 1000)) > defaultPlayerMass && this.massTotal > minMassLoss) {
                const massLoss = this.cells[i].mass * (massLossRate / 1000);
                this.changeCellMass(Number(i), -massLoss);
            }
        }
    }

    changeCellMass(cellIndex: number, massDifference: number): void {
        this.cells[cellIndex].addMass(massDifference);
        this.massTotal += massDifference;
    }

    removeCell(cellIndex: number): boolean {
        this.massTotal -= this.cells[cellIndex].mass;
        this.cells.splice(cellIndex, 1);
        return this.cells.length === 0;
    }

    // Splits a cell into multiple cells with identical mass.
    // Creates n-1 new cells and lowers the mass of the original cell.
    // If resulting cells would be smaller than defaultPlayerMass,
    // creates fewer and bigger cells.
    splitCell(cellIndex: number, maxRequestedPieces: number, defaultPlayerMass: number): void {
        const cellToSplit = this.cells[cellIndex];
        const maxAllowedPieces = Math.floor(cellToSplit.mass / defaultPlayerMass);
        const piecesToCreate = Math.min(maxAllowedPieces, maxRequestedPieces);
        if (piecesToCreate === 0) {
            return;
        }
        const newCellsMass = cellToSplit.mass / piecesToCreate;
        for (let i = 0; i < piecesToCreate - 1; i++) {
            this.cells.push(new Cell(cellToSplit.x, cellToSplit.y, newCellsMass, SPLIT_CELL_SPEED));
        }
        cellToSplit.setMass(newCellsMass);
        this.setLastSplit();
    }

    // Split resulting from colliding with a virus. Player ends with the
    // highest possible number of cells.
    virusSplit(cellIndexes: number[], maxCells: number, defaultPlayerMass: number): void {
        for (const cellIndex of cellIndexes) {
            this.splitCell(cellIndex, maxCells - this.cells.length + 1, defaultPlayerMass);
        }
    }

    // Split initiated by the player. Tries to split every cell in half.
    userSplit(maxCells: number, defaultPlayerMass: number): void {
        let cellsToCreate: number;
        if (this.cells.length > maxCells / 2) {
            cellsToCreate = maxCells - this.cells.length + 1;
            this.cells.sort((a, b) => b.mass - a.mass);
        } else {
            cellsToCreate = this.cells.length;
        }

        for (let i = 0; i < cellsToCreate; i++) {
            this.splitCell(i, 2, defaultPlayerMass);
        }
    }

    // Loops through cells and calls callback with colliding ones. Passes the
    // colliding cells and their indexes. Null values are skipped during the
    // iteration and removed at the end.
    enumerateCollidingCells(callback: (cells: Array<Cell | null>, a: number, b: number) => void): void {
        const cells = this.cells as Array<Cell | null>;
        for (let cellAIndex = 0; cellAIndex < cells.length; cellAIndex++) {
            const cellA = cells[cellAIndex];
            if (!cellA) continue;

            for (let cellBIndex = cellAIndex + 1; cellBIndex < cells.length; cellBIndex++) {
                const cellB = cells[cellBIndex];
                if (!cellB) continue;
                const colliding = sat.testCircleCircle(cellA.toCircle(), cellB.toCircle());
                if (colliding) {
                    callback(cells, cellAIndex, cellBIndex);
                }
            }
        }

        this.cells = util.removeNulls(cells);
    }

    mergeCollidingCells(): void {
        this.enumerateCollidingCells((cells, cellAIndex, cellBIndex) => {
            cells[cellAIndex]!.addMass(cells[cellBIndex]!.mass);
            cells[cellBIndex] = null;
        });
    }

    pushAwayCollidingCells(): void {
        this.enumerateCollidingCells((cells, cellAIndex, cellBIndex) => {
            const cellA = cells[cellAIndex]!;
            const cellB = cells[cellBIndex]!;
            let vector = new sat.Vector(cellB.x - cellA.x, cellB.y - cellA.y);
            vector = vector.normalize().scale(PUSHING_AWAY_SPEED, PUSHING_AWAY_SPEED);
            if (vector.len() === 0) {
                vector = new sat.Vector(0, 1);
            }

            cellA.x -= vector.x;
            cellA.y -= vector.y;

            cellB.x += vector.x;
            cellB.y += vector.y;
        });
    }

    move(slowBase: number, gameWidth: number, gameHeight: number, initMassLog: number): void {
        if (this.cells.length > 1) {
            if (this.timeToMerge !== null && this.timeToMerge < Date.now()) {
                this.mergeCollidingCells();
            } else {
                this.pushAwayCollidingCells();
            }
        }

        let xSum = 0, ySum = 0;
        for (let i = 0; i < this.cells.length; i++) {
            const cell = this.cells[i];
            cell.move(this.x, this.y, this.target, slowBase, initMassLog);
            gameLogic.adjustForBoundaries(cell, cell.radius / 3, 0, gameWidth, gameHeight);
            xSum += cell.x;
            ySum += cell.y;
        }
        this.x = xSum / this.cells.length;
        this.y = ySum / this.cells.length;
    }

    // Invokes callback if either cell ate the other.
    static checkForCollisions(
        playerA: Player,
        playerB: Player,
        playerAIndex: number,
        playerBIndex: number,
        callback: CollisionCallback
    ): void {
        for (const cellAIndex in playerA.cells) {
            for (const cellBIndex in playerB.cells) {
                const cellA = playerA.cells[cellAIndex];
                const cellB = playerB.cells[cellBIndex];

                const cellAData = { playerIndex: playerAIndex, cellIndex: Number(cellAIndex) };
                const cellBData = { playerIndex: playerBIndex, cellIndex: Number(cellBIndex) };

                const whoAteWho = Cell.checkWhoAteWho(cellA, cellB);

                if (whoAteWho === 1) {
                    callback(cellBData, cellAData);
                } else if (whoAteWho === 2) {
                    callback(cellAData, cellBData);
                }
            }
        }
    }
}

export class PlayerManager {
    data: Player[];

    constructor() {
        this.data = [];
    }

    pushNew(player: Player): void {
        this.data.push(player);
    }

    findIndexByID(id: string): number {
        return util.findIndex(this.data, id);
    }

    removePlayerByID(id: string): void {
        const index = this.findIndexByID(id);
        if (index > -1) {
            this.removePlayerByIndex(index);
        }
    }

    removePlayerByIndex(index: number): void {
        this.data.splice(index, 1);
    }

    shrinkCells(massLossRate: number, defaultPlayerMass: number, minMassLoss: number): void {
        for (const player of this.data) {
            player.loseMassIfNeeded(massLossRate, defaultPlayerMass, minMassLoss);
        }
    }

    removeCell(playerIndex: number, cellIndex: number): boolean {
        return this.data[playerIndex].removeCell(cellIndex);
    }

    getCell(playerIndex: number, cellIndex: number): Cell {
        return this.data[playerIndex].cells[cellIndex];
    }

    handleCollisions(callback: CollisionCallback): void {
        for (let playerAIndex = 0; playerAIndex < this.data.length; playerAIndex++) {
            for (let playerBIndex = playerAIndex + 1; playerBIndex < this.data.length; playerBIndex++) {
                Player.checkForCollisions(
                    this.data[playerAIndex],
                    this.data[playerBIndex],
                    playerAIndex,
                    playerBIndex,
                    callback
                );
            }
        }
    }

    getTopPlayers(): Array<{ id: string; name: string | null }> {
        this.data.sort((a, b) => b.massTotal - a.massTotal);
        const topPlayers: Array<{ id: string; name: string | null }> = [];
        for (let i = 0; i < Math.min(10, this.data.length); i++) {
            topPlayers.push({
                id: this.data[i].id,
                name: this.data[i].name
            });
        }
        return topPlayers;
    }

    getTotalMass(): number {
        let result = 0;
        for (const player of this.data) {
            result += player.massTotal;
        }
        return result;
    }
}

module.exports = { Player, PlayerManager };
