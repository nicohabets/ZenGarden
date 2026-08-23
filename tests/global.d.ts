import type { ZenGardenAPI } from "../src/types";

declare global {
  interface Window {
    __ZEN_GARDEN__?: ZenGardenAPI;
  }
}

export {};
