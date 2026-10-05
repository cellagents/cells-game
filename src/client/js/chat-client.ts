import global from './global';

interface Command {
    description: string;
    callback: (args: string[]) => void;
}

class ChatClient {
    canvas: any;
    socket: any;
    mobile: boolean;
    player: any;
    commands: Record<string, Command>;

    constructor(_params?: unknown) {
        this.canvas = (global as any).canvas;
        this.socket = (global as any).socket;
        this.mobile = global.mobile;
        this.player = (global as any).player;
        const self = this;
        this.commands = {};
        let input = document.getElementById('chatInput') as HTMLInputElement;
        input.addEventListener('keypress', this.sendChat.bind(this));
        input.addEventListener('keyup', (key: Event) => {
            input = document.getElementById('chatInput') as HTMLInputElement;
            const code = (key as KeyboardEvent).which || (key as KeyboardEvent).keyCode;
            if (code === global.KEY_ESC) {
                input.value = '';
                self.canvas.cv.focus();
            }
        });
        (global as any).chatClient = this;
    }

    // TODO: Break out many of these GameControls into separate classes.

    registerFunctions(): void {
        const self = this;
        this.registerCommand('ping', 'Check your latency.', () => {
            self.checkLatency();
        });

        this.registerCommand('dark', 'Toggle dark mode.', () => {
            self.toggleDarkMode();
        });

        this.registerCommand('border', 'Toggle visibility of border.', () => {
            self.toggleBorder();
        });

        this.registerCommand('mass', 'Toggle visibility of mass.', () => {
            self.toggleMass();
        });

        this.registerCommand('continuity', 'Toggle continuity.', () => {
            self.toggleContinuity();
        });

        this.registerCommand('roundfood', 'Toggle food drawing.', (args) => {
            self.toggleRoundFood(args);
        });

        this.registerCommand('help', 'Information about the chat commands.', () => {
            self.printHelp();
        });
        (global as any).chatClient = this;
    }

    addChatLine(name: string, message: string, me: boolean): void {
        if (this.mobile) return;
        const newline = document.createElement('li');
        newline.className = me ? 'me' : 'friend';
        newline.innerHTML = '<b>' + ((name.length < 1) ? 'An unnamed cell' : name) + '</b>: ' + message;
        this.appendMessage(newline);
    }

    addSystemLine(message: string): void {
        if (this.mobile) return;
        const newline = document.createElement('li');
        newline.className = 'system';
        newline.innerHTML = message;
        this.appendMessage(newline);
    }

    appendMessage(node: HTMLElement): void {
        if (this.mobile) return;
        const chatList = document.getElementById('chatList')!;
        if (chatList.childNodes.length > 10) {
            chatList.removeChild(chatList.childNodes[0]);
        }
        chatList.appendChild(node);
    }

    sendChat(key: Event): void {
        const commands = this.commands;
        const input = document.getElementById('chatInput') as HTMLInputElement;
        const code = (key as KeyboardEvent).which || (key as KeyboardEvent).keyCode;

        if (code === global.KEY_ENTER) {
            const text = input.value.replace(/(<([^>]+)>)/ig, '');
            if (text !== '') {
                if (text.indexOf('-') === 0) {
                    const args = text.substring(1).split(' ');
                    if (commands[args[0]]) {
                        commands[args[0]].callback(args.slice(1));
                    } else {
                        this.addSystemLine('Unrecognized Command: ' + text + ', type -help for more info.');
                    }
                } else {
                    this.socket.emit('playerChat', { sender: this.player.name, message: text });
                    this.addChatLine(this.player.name, text, true);
                }

                input.value = '';
                this.canvas.cv.focus();
            }
        }
    }

    registerCommand(name: string, description: string, callback: (args: string[]) => void): void {
        this.commands[name] = { description, callback };
    }

    printHelp(): void {
        const commands = this.commands;
        for (const cmd in commands) {
            if (Object.prototype.hasOwnProperty.call(commands, cmd)) {
                this.addSystemLine('-' + cmd + ': ' + commands[cmd].description);
            }
        }
    }

    checkLatency(): void {
        global.startPingTime = Date.now();
        this.socket.emit('pingcheck');
    }

    toggleDarkMode(): void {
        const LIGHT = '#f2fbff';
        const DARK = '#181818';
        const LINELIGHT = '#000000';
        const LINEDARK = '#ffffff';

        if (global.backgroundColor === LIGHT) {
            global.backgroundColor = DARK;
            global.lineColor = LINEDARK;
            this.addSystemLine('Dark mode enabled.');
        } else {
            global.backgroundColor = LIGHT;
            global.lineColor = LINELIGHT;
            this.addSystemLine('Dark mode disabled.');
        }
    }

    toggleBorder(): void {
        if (!global.borderDraw) {
            global.borderDraw = true;
            this.addSystemLine('Showing border.');
        } else {
            global.borderDraw = false;
            this.addSystemLine('Hiding border.');
        }
    }

    toggleMass(): void {
        if (global.toggleMassState === 0) {
            global.toggleMassState = 1;
            this.addSystemLine('Viewing mass enabled.');
        } else {
            global.toggleMassState = 0;
            this.addSystemLine('Viewing mass disabled.');
        }
    }

    toggleContinuity(): void {
        if (!global.continuity) {
            global.continuity = true;
            this.addSystemLine('Continuity enabled.');
        } else {
            global.continuity = false;
            this.addSystemLine('Continuity disabled.');
        }
    }

    toggleRoundFood(args: string[]): void {
        const g = global as any;
        if (args || g.foodSides < 10) {
            g.foodSides = (args && !isNaN(Number(args[0])) && +args[0] >= 3) ? +args[0] : 10;
            this.addSystemLine('Food is now rounded!');
        } else {
            g.foodSides = 5;
            this.addSystemLine('Food is no longer rounded!');
        }
    }
}

export default ChatClient;
