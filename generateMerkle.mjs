import { getMerkleRoot } from "@metaplex-foundation/mpl-candy-machine";

// COPY YOUR WHITELIST HERE (same as website)
const WHITELIST = [
  "2aSJBUGpWWUZty3dafov1Z8Edw3YPA6Z1e2X3aqXu27i",
  "CjBK1dYZpuvvHQzj1Lt4h4pGNpr2xc7hk4mijG6G27VX",
  "5xdg4SRm6SULCeMkrveX4faGPipbJUgA89UKZ5w93Lto",
  // ...PASTE ALL WL ADDRESSES HERE
];

// IMPORTANT: sort for deterministic root
const sorted = WHITELIST.sort();

const merkleRoot = getMerkleRoot(sorted);

console.log("MERKLE ROOT (hex):");
console.log(Buffer.from(merkleRoot).toString("hex"));

