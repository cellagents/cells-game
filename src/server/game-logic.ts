export function adjustForBoundaries(
    position: { x: number; y: number },
    radius: number,
    borderOffset: number,
    gameWidth: number,
    gameHeight: number
): void {
    const borderCalc = radius + borderOffset;
    if (position.x > gameWidth - borderCalc) {
        position.x = gameWidth - borderCalc;
    }
    if (position.y > gameHeight - borderCalc) {
        position.y = gameHeight - borderCalc;
    }
    if (position.x < borderCalc) {
        position.x = borderCalc;
    }
    if (position.y < borderCalc) {
        position.y = borderCalc;
    }
}

module.exports = { adjustForBoundaries };
