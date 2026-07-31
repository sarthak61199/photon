import { cpus } from "node:os";
import pLimit from "p-limit";

export const sharpLimit = pLimit(Math.max(2, cpus().length * 2));
