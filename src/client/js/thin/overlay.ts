// Minimal overlay helper shared by the spectator and follow pages.
// Expects the HTML has:
//   <div id="statusOverlay" hidden>
//     <div class="status-card">
//       <p id="statusMessage"></p>
//       <a id="statusAction" href="/" hidden>Back to lobby</a>
//     </div>
//   </div>

export interface StatusOptions {
    /** When true, show the "Back to lobby" link in the overlay. In
     *  embedded views (e.g. /managed) we hide it so the viewport
     *  doesn't offer a self-escape route from inside an iframe. */
    showExit: boolean;
}

export class StatusOverlay {
    private root: HTMLElement | null;
    private msg: HTMLElement | null;
    private action: HTMLElement | null;

    constructor(private readonly opts: StatusOptions) {
        this.root = document.getElementById('statusOverlay');
        this.msg = document.getElementById('statusMessage');
        this.action = document.getElementById('statusAction');
    }

    show(message: string, withExit = false): void {
        if (!this.root || !this.msg) return;
        this.msg.textContent = message;
        if (this.action) {
            this.action.hidden = !(withExit && this.opts.showExit);
        }
        this.root.hidden = false;
    }

    hide(): void {
        if (this.root) this.root.hidden = true;
    }
}
