export function depthOf(node) {
  return node.parent ? depthOf(node.parent) + 1 : node.root.depth;
}

export function chain(length) {
  let node = {};
  for (let index = 0; index < length; index += 1) {
    node = { parent: node };
  }
  return node;
}
