interface Node {
  char: number;
  parent: Node | null;
  children: Node[];
  ids?: number[];
}

export interface Trie {
  add(address: string, id: number): void;
  remove(address: string, id: number): void;
  get(address: string): number[];
}

const EMPTY_ARR: number[] = [];
const a = 'a'.charCodeAt(0);
const A = 'A'.charCodeAt(0);
const diff = a - A;
const Z = 'Z'.charCodeAt(0);

function createNode(char: number, parent?: Node): Node {
  const result = { char, children: [], parent: parent || null };
  if (parent) {
    parent.children.push(result);
  }
  return result;
}

function getCharAt(str: string, at: number) {
  const c = str.charCodeAt(at);
  if (c >= A && c <= Z) {
    return c + diff;
  }

  return c;
}

export function createPrefixTrie(): Trie {
  const root = createNode(0);
  const findNearestNodeOrEntry = (address: string): [Node, number] | Node => {
    const len = address.length;
    let i = 0;
    let node = root;
    while (i !== len) {
      let newNode: Node | undefined;
      const char = getCharAt(address, i);
      for (const child of node.children) {
        if (child.char === char) {
          newNode = child;
          break;
        }
      }
      if (newNode) {
        node = newNode;
        i++;
      } else {
        break;
      }
    }

    if (i === len) return node;
    return [node, i];
  };
  const add: Trie['add'] = (address, id) => {
    const nearest = findNearestNodeOrEntry(address);
    if (!Array.isArray(nearest)) {
      if (nearest.ids!.indexOf(id) === -1) {
        nearest.ids!.push(id);
      }
      return;
    }

    let [node, i] = nearest;
    for (let k = i; k < address.length; k++) {
      node = createNode(getCharAt(address, k), node);
    }

    node.ids = [id];
  };
  const remove: Trie['remove'] = (address, id) => {
    const nearest = findNearestNodeOrEntry(address);
    if (Array.isArray(nearest)) return;
    const i = nearest.ids!.indexOf(id);
    if (i > -1) {
      if (nearest.ids!.length > 1) {
        nearest.ids!.splice(i, 1);
        return;
      }
    } else {
      return;
    }
    let node: Node = nearest;
    while (node.parent) {
      const parent = node.parent;
      node.parent = null;
      if (parent.children.length > 1) {
        const i = parent.children.indexOf(node);
        parent.children.splice(i, 1);
        return;
      }
      parent.children = [];
      node = parent;
    }
  };
  const get: Trie['get'] = (address) => {
    const nearest = findNearestNodeOrEntry(address);
    if (Array.isArray(nearest)) return EMPTY_ARR;
    return nearest.ids || EMPTY_ARR;
  };

  return { add, remove, get };
}
