import { inject } from "vitest";
import { contract } from "./api";

const origin = inject("goServer");

contract({ fetch: (path, init) => fetch(origin + path, init) });
