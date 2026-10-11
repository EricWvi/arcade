/*
 * Saves for games that export and import save files through Flash's
 * FileReference, like 造梦西游's SAV mod. In the browser Ruffle turns
 * FileReference.save() into a blob download and FileReference.browse()
 * into a click on its hidden file input (#rfd-input). While a game runs,
 * both are caught here and handed to the page, which keeps the files on
 * the server instead of the player's disk.
 */

/** A save file the movie wants written. */
export type SaveRequest = { data: string; suggestedName: string };

/** The movie asked for a file to load; answer with one of these. */
export type LoadRequest = {
  /** Gives the movie this file as if the player had picked it. */
  pick(name: string, data: string): void;
  /** Opens the real file picker, for importing a file from disk. */
  browse(onPicked: (name: string, data: string) => void): void;
  /** Tells the movie the player changed their mind. */
  cancel(): void;
};

export type FileSaveHandlers = {
  onSave(request: SaveRequest): void;
  onLoad(request: LoadRequest): void;
};

/**
 * Starts catching the movie's file dialogs. Returns a function that stops.
 * Only one game runs at a time, so patching the prototypes is safe.
 */
export function catchFileDialogs(handlers: FileSaveHandlers): () => void {
  const anchorClick = HTMLAnchorElement.prototype.click;
  const inputClick = HTMLInputElement.prototype.click;

  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    if (!this.hasAttribute("download") || !this.href.startsWith("blob:")) return anchorClick.call(this);
    // Ruffle revokes the URL as soon as click() returns; a fetch started
    // now has already resolved it.
    const suggestedName = this.download;
    fetch(this.href)
      .then((res) => res.text())
      .then((data) => handlers.onSave({ data, suggestedName }))
      .catch((err: unknown) => console.error("read save file", err));
  };

  HTMLInputElement.prototype.click = function (this: HTMLInputElement) {
    if (this.type !== "file" || this.id !== "rfd-input") return inputClick.call(this);
    const input = this;
    handlers.onLoad({
      pick(name, data) {
        const files = new DataTransfer();
        files.items.add(new File([data], name, { type: "application/json" }));
        input.files = files.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      },
      browse(onPicked) {
        input.addEventListener(
          "change",
          () => {
            const file = input.files?.[0];
            if (file) file.text().then((data) => onPicked(file.name, data));
          },
          { once: true },
        );
        inputClick.call(input);
      },
      cancel() {
        // The dialog's own Cancel button, hidden while it is unused.
        const buttons = input.parentElement?.querySelectorAll<HTMLButtonElement>("button");
        buttons?.[buttons.length - 1]?.click();
      },
    });
  };

  return () => {
    HTMLAnchorElement.prototype.click = anchorClick;
    HTMLInputElement.prototype.click = inputClick;
  };
}
