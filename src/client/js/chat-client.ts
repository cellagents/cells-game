// Game chat controller. Thin wrapper around the shared chat widget that
// adds the game-specific command set (/dark, /mass, etc.) and the game's
// focus-handling (ESC returns focus to the canvas).

import global from './global';
import { createChat, ChatHandle } from './chat/chat';
import { applyTheme, cycleTheme, currentTheme } from './theme';

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
    chat!: ChatHandle;

    constructor(_params?: unknown) {
        this.canvas = (global as any).canvas;
        this.socket = (global as any).socket;
        this.mobile = global.mobile;
        this.player = (global as any).player;
        this.commands = {};

        if (this.mobile) {
            // Original behaviour: no chat on mobile.
            (global as any).chatClient = this;
            return;
        }

        const container = document.getElementById('chatbox') as HTMLElement;
        this.chat = createChat({
            container,
            socket: this.socket,
            events: { chat: true, system: true, join: true, leave: true, death: true },
            selfName: this.player?.name,
            maxLines: 10,
            enableInput: true,
            inputPlaceholder: 'Chat here...',
            onSendMessage: (text) => this.handleSubmit(text)
        });

        if (this.chat.input) {
            this.chat.input.addEventListener('keyup', (ev) => {
                if ((ev as KeyboardEvent).key === 'Escape') {
                    this.chat.input!.value = '';
                    this.canvas.cv.focus();
                }
            });
        }
        (global as any).chatClient = this;
    }

    registerFunctions(): void {
        this.registerCommand('ping', 'Check your latency.', () => this.checkLatency());
        this.registerCommand('dark', 'Toggle dark mode.', () => this.toggleDarkMode());
        this.registerCommand('border', 'Toggle visibility of border.', () => this.toggleBorder());
        this.registerCommand('mass', 'Toggle visibility of mass.', () => this.toggleMass());
        this.registerCommand('continuity', 'Toggle continuity.', () => this.toggleContinuity());
        this.registerCommand('roundfood', 'Toggle food drawing.', (args) => this.toggleRoundFood(args));
        this.registerCommand('help', 'Information about the chat commands.', () => this.printHelp());
        // Keep selfName in sync once we know our name.
        if (this.chat && this.player?.name) (this.chat as any).selfName = this.player.name;
        (global as any).chatClient = this;
    }

    // Backwards-compatible shims used by app.ts for events the shared chat
    // doesn't subscribe to directly (welcome, kick, pongcheck replies).
    addChatLine(name: string, message: string, me: boolean): void {
        if (!this.chat) return;
        this.chat.addChat(me ? (this.player?.name ?? name) : name, message);
    }

    addSystemLine(message: string): void {
        if (!this.chat) return;
        this.chat.addSystem(message);
    }

    handleSubmit(text: string): void {
        if (text.indexOf('-') === 0) {
            const args = text.substring(1).split(' ');
            const cmd = this.commands[args[0]];
            if (cmd) cmd.callback(args.slice(1));
            else this.addSystemLine('Unrecognized Command: ' + text + ', type -help for more info.');
        } else {
            this.socket.emit('playerChat', { sender: this.player.name, message: text });
            this.addChatLine(this.player.name, text, true);
        }
        this.canvas.cv.focus();
    }

    registerCommand(name: string, description: string, callback: (args: string[]) => void): void {
        this.commands[name] = { description, callback };
    }

    printHelp(): void {
        for (const cmd in this.commands) {
            if (Object.prototype.hasOwnProperty.call(this.commands, cmd)) {
                this.addSystemLine('-' + cmd + ': ' + this.commands[cmd].description);
            }
        }
    }

    checkLatency(): void {
        global.startPingTime = Date.now();
        this.socket.emit('pingcheck');
    }

    toggleDarkMode(): void {
        const next = cycleTheme();
        applyTheme(next);
        this.addSystemLine(next === 'dark' ? 'Dark mode enabled.' : 'Dark mode disabled.');
        // Keep the legacy global values the canvas renderer reads in sync.
        if (next === 'dark') {
            global.backgroundColor = '#181818';
            global.lineColor = '#ffffff';
        } else {
            global.backgroundColor = '#f2fbff';
            global.lineColor = '#000000';
        }
    }

    toggleBorder(): void {
        global.borderDraw = !global.borderDraw;
        this.addSystemLine(global.borderDraw ? 'Showing border.' : 'Hiding border.');
    }

    toggleMass(): void {
        global.toggleMassState = global.toggleMassState === 0 ? 1 : 0;
        this.addSystemLine(global.toggleMassState === 1 ? 'Viewing mass enabled.' : 'Viewing mass disabled.');
    }

    toggleContinuity(): void {
        global.continuity = !global.continuity;
        this.addSystemLine(global.continuity ? 'Continuity enabled.' : 'Continuity disabled.');
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

// Initialise theme from storage before the chat exists so the toggle is in
// sync when it renders.
applyTheme(currentTheme());

export default ChatClient;
