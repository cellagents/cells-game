type Ctx = CanvasRenderingContext2D;

interface Position { x: number; y: number; }
interface Food { radius: number; hue: number; }
interface Virus { radius: number; stroke: string; fill: string; strokeWidth: number; }
interface Mass { radius: number; hue: number; }
interface PlayerConfig {
    border: number;
    textColor: string;
    textBorder: string;
    textBorderSize: number;
    defaultSize: number;
}
interface Cell {
    x: number;
    y: number;
    mass: number;
    radius: number;
    name: string;
    color: string;
    borderColor: string;
}
interface Borders { left: number; right: number; top: number; bottom: number; }

const FULL_ANGLE = 2 * Math.PI;

const drawRoundObject = (position: Position, radius: number, graph: Ctx): void => {
    graph.beginPath();
    graph.arc(position.x, position.y, radius, 0, FULL_ANGLE);
    graph.closePath();
    graph.fill();
    graph.stroke();
};

const drawFood = (position: Position, food: Food, graph: Ctx): void => {
    graph.fillStyle = 'hsl(' + food.hue + ', 100%, 50%)';
    graph.strokeStyle = 'hsl(' + food.hue + ', 100%, 45%)';
    graph.lineWidth = 0;
    drawRoundObject(position, food.radius, graph);
};

const drawVirus = (position: Position, virus: Virus, graph: Ctx): void => {
    graph.strokeStyle = virus.stroke;
    graph.fillStyle = virus.fill;
    graph.lineWidth = virus.strokeWidth;
    const sides = 20;

    graph.beginPath();
    for (let theta = 0; theta < FULL_ANGLE; theta += FULL_ANGLE / sides) {
        const point = circlePoint(position, virus.radius, theta);
        graph.lineTo(point.x, point.y);
    }
    graph.closePath();
    graph.stroke();
    graph.fill();
};

const drawFireFood = (position: Position, mass: Mass, playerConfig: PlayerConfig, graph: Ctx): void => {
    graph.strokeStyle = 'hsl(' + mass.hue + ', 100%, 45%)';
    graph.fillStyle = 'hsl(' + mass.hue + ', 100%, 50%)';
    graph.lineWidth = playerConfig.border + 2;
    drawRoundObject(position, mass.radius - 1, graph);
};

const valueInRange = (min: number, max: number, value: number): number => Math.min(max, Math.max(min, value));

const circlePoint = (origo: Position, radius: number, theta: number): Position => ({
    x: origo.x + radius * Math.cos(theta),
    y: origo.y + radius * Math.sin(theta)
});

const cellTouchingBorders = (cell: Cell, borders: Borders): boolean =>
    cell.x - cell.radius <= borders.left ||
    cell.x + cell.radius >= borders.right ||
    cell.y - cell.radius <= borders.top ||
    cell.y + cell.radius >= borders.bottom;

const regulatePoint = (point: Position, borders: Borders): Position => ({
    x: valueInRange(borders.left, borders.right, point.x),
    y: valueInRange(borders.top, borders.bottom, point.y)
});

const drawCellWithLines = (cell: Cell, borders: Borders, graph: Ctx): void => {
    const pointCount = 30 + ~~(cell.mass / 5);
    const points: Position[] = [];
    for (let theta = 0; theta < FULL_ANGLE; theta += FULL_ANGLE / pointCount) {
        const point = circlePoint(cell, cell.radius, theta);
        points.push(regulatePoint(point, borders));
    }
    graph.beginPath();
    graph.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
        graph.lineTo(points[i].x, points[i].y);
    }
    graph.closePath();
    graph.fill();
    graph.stroke();
};

const drawCells = (cells: Cell[], playerConfig: PlayerConfig, toggleMassState: number, borders: Borders, graph: Ctx): void => {
    for (const cell of cells) {
        graph.fillStyle = cell.color;
        graph.strokeStyle = cell.borderColor;
        graph.lineWidth = 6;
        if (cellTouchingBorders(cell, borders)) {
            drawCellWithLines(cell, borders, graph);
        } else {
            drawRoundObject(cell, cell.radius, graph);
        }

        let fontSize = Math.max(cell.radius / 3, 12);
        graph.lineWidth = playerConfig.textBorderSize;
        graph.fillStyle = playerConfig.textColor;
        graph.strokeStyle = playerConfig.textBorder;
        graph.miterLimit = 1;
        graph.lineJoin = 'round';
        graph.textAlign = 'center';
        graph.textBaseline = 'middle';
        graph.font = 'bold ' + fontSize + 'px sans-serif';
        graph.strokeText(cell.name, cell.x, cell.y);
        graph.fillText(cell.name, cell.x, cell.y);

        if (toggleMassState === 1) {
            graph.font = 'bold ' + Math.max(fontSize / 3 * 2, 10) + 'px sans-serif';
            if (cell.name.length === 0) fontSize = 0;
            graph.strokeText(String(Math.round(cell.mass)), cell.x, cell.y + fontSize);
            graph.fillText(String(Math.round(cell.mass)), cell.x, cell.y + fontSize);
        }
    }
};

const drawGrid = (global: { lineColor: string }, player: Position, screen: { width: number; height: number }, graph: Ctx): void => {
    graph.lineWidth = 1;
    graph.strokeStyle = global.lineColor;
    graph.globalAlpha = 0.15;
    graph.beginPath();

    for (let x = -player.x; x < screen.width; x += screen.height / 18) {
        graph.moveTo(x, 0);
        graph.lineTo(x, screen.height);
    }

    for (let y = -player.y; y < screen.height; y += screen.height / 18) {
        graph.moveTo(0, y);
        graph.lineTo(screen.width, y);
    }

    graph.stroke();
    graph.globalAlpha = 1;
};

const drawBorder = (borders: Borders, graph: Ctx): void => {
    graph.lineWidth = 1;
    graph.strokeStyle = '#000000';
    graph.beginPath();
    graph.moveTo(borders.left, borders.top);
    graph.lineTo(borders.right, borders.top);
    graph.lineTo(borders.right, borders.bottom);
    graph.lineTo(borders.left, borders.bottom);
    graph.closePath();
    graph.stroke();
};

const drawErrorMessage = (message: string, graph: Ctx, screen: { width: number; height: number }): void => {
    graph.fillStyle = '#333333';
    graph.fillRect(0, 0, screen.width, screen.height);
    graph.textAlign = 'center';
    graph.fillStyle = '#FFFFFF';
    graph.font = 'bold 30px sans-serif';
    graph.fillText(message, screen.width / 2, screen.height / 2);
};

export {
    drawFood,
    drawVirus,
    drawFireFood,
    drawCells,
    drawErrorMessage,
    drawGrid,
    drawBorder
};
