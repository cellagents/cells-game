import global from './global';

type Direction = number;

class Canvas {
    directionLock: boolean;
    target: { x: number; y: number };
    reenviar: boolean;
    socket: any;
    directions: Direction[];
    cv: HTMLCanvasElement & { parent?: Canvas };
    width!: number;
    height!: number;

    constructor(_params?: unknown) {
        this.directionLock = false;
        this.target = (global as any).target;
        this.reenviar = true;
        this.socket = (global as any).socket;
        this.directions = [];

        this.cv = document.getElementById('cvs') as HTMLCanvasElement & { parent?: Canvas };
        this.cv.width = global.screen.width;
        this.cv.height = global.screen.height;
        this.cv.addEventListener('mousemove', this.gameInput, false);
        this.cv.addEventListener('mouseout', this.outOfBounds, false);
        this.cv.addEventListener('keypress', this.keyInput, false);
        this.cv.addEventListener('keyup', (event) => {
            this.reenviar = true;
            this.directionUp(event as unknown as KeyboardEvent & { parent: Canvas });
        }, false);
        this.cv.addEventListener('keydown', this.directionDown, false);
        this.cv.addEventListener('touchstart', this.touchInput, false);
        this.cv.addEventListener('touchmove', this.touchInput, false);
        this.cv.parent = this;
        (global as any).canvas = this;
    }

    directionDown(this: any, event: KeyboardEvent): void {
        const key = event.which || event.keyCode;
        const self: Canvas = this.parent;
        if (self.directional(key)) {
            self.directionLock = true;
            if (self.newDirection(key, self.directions, true)) {
                self.updateTarget(self.directions);
                self.socket.emit('0', self.target);
            }
        }
    }

    directionUp(event: KeyboardEvent): void {
        const key = event.which || event.keyCode;
        if (this.directional(key)) {
            if (this.newDirection(key, this.directions, false)) {
                this.updateTarget(this.directions);
                if (this.directions.length === 0) this.directionLock = false;
                this.socket.emit('0', this.target);
            }
        }
    }

    newDirection(direction: Direction, list: Direction[], isAddition: boolean): boolean {
        let result = false;
        let found = false;
        for (let i = 0, len = list.length; i < len; i++) {
            if (list[i] == direction) {
                found = true;
                if (!isAddition) {
                    result = true;
                    list.splice(i, 1);
                }
                break;
            }
        }
        if (isAddition && found === false) {
            result = true;
            list.push(direction);
        }
        return result;
    }

    updateTarget(list: Direction[]): void {
        this.target = { x: 0, y: 0 };
        let directionHorizontal = 0;
        let directionVertical = 0;
        for (let i = 0, len = list.length; i < len; i++) {
            if (directionHorizontal === 0) {
                if (list[i] == global.KEY_LEFT) directionHorizontal -= Number.MAX_VALUE;
                else if (list[i] == global.KEY_RIGHT) directionHorizontal += Number.MAX_VALUE;
            }
            if (directionVertical === 0) {
                if (list[i] == global.KEY_UP) directionVertical -= Number.MAX_VALUE;
                else if (list[i] == global.KEY_DOWN) directionVertical += Number.MAX_VALUE;
            }
        }
        this.target.x += directionHorizontal;
        this.target.y += directionVertical;
        (global as any).target = this.target;
    }

    directional(key: number): boolean {
        return this.horizontal(key) || this.vertical(key);
    }

    horizontal(key: number): boolean {
        return key == global.KEY_LEFT || key == global.KEY_RIGHT;
    }

    vertical(key: number): boolean {
        return key == global.KEY_DOWN || key == global.KEY_UP;
    }

    outOfBounds(this: any): void {
        if (!global.continuity) {
            this.parent.target = { x: 0, y: 0 };
            (global as any).target = this.parent.target;
        }
    }

    gameInput(this: any, mouse: MouseEvent): void {
        if (!this.directionLock) {
            this.parent.target.x = mouse.clientX - this.width / 2;
            this.parent.target.y = mouse.clientY - this.height / 2;
            (global as any).target = this.parent.target;
        }
    }

    touchInput(this: any, touch: TouchEvent): void {
        touch.preventDefault();
        touch.stopPropagation();
        if (!this.directionLock) {
            this.parent.target.x = touch.touches[0].clientX - this.width / 2;
            this.parent.target.y = touch.touches[0].clientY - this.height / 2;
            (global as any).target = this.parent.target;
        }
    }

    keyInput(this: any, event: KeyboardEvent): void {
        const key = event.which || event.keyCode;
        if (key === global.KEY_FIREFOOD && this.parent.reenviar) {
            this.parent.socket.emit('1');
            this.parent.reenviar = false;
        } else if (key === global.KEY_SPLIT && this.parent.reenviar) {
            (document.getElementById('split_cell') as HTMLAudioElement).play();
            this.parent.socket.emit('2');
            this.parent.reenviar = false;
        } else if (key === global.KEY_CHAT) {
            document.getElementById('chatInput')!.focus();
        }
    }
}

export default Canvas;
