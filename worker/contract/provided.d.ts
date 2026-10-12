import "vitest";

declare module "vitest" {
  interface ProvidedContext {
    /** Origin of the Go server under test. */
    goServer: string;
    /** R2 object key → base64 content: the fixture as `arcade catalog build` publishes it. */
    published: Record<string, string>;
  }
}
