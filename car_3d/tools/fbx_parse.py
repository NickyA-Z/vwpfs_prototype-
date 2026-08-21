"""Minimal reader for binary FBX 7.x files (static meshes only)."""
import struct, zlib

class Node:
    __slots__ = ('name', 'props', 'children')
    def __init__(self, name, props, children):
        self.name, self.props, self.children = name, props, children
    def find(self, name):
        for c in self.children:
            if c.name == name:
                return c
        return None
    def find_all(self, name):
        return [c for c in self.children if c.name == name]
    def __repr__(self):
        return f'<Node {self.name} props={len(self.props)} kids={len(self.children)}>'

_ARRAY_FMT = {'f': ('f', 4), 'd': ('d', 8), 'l': ('q', 8), 'i': ('i', 4), 'b': ('b', 1)}

def _read_array(data, p, code):
    length, encoding, comp_len = struct.unpack_from('<III', data, p)
    p += 12
    raw = data[p:p + comp_len]
    p += comp_len
    if encoding == 1:
        raw = zlib.decompress(raw)
    fmt, size = _ARRAY_FMT[code]
    return list(struct.unpack('<%d%s' % (length, fmt), raw[:length * size])), p

def _read_props(data, p, count):
    props = []
    for _ in range(count):
        t = chr(data[p]); p += 1
        if t == 'Y':   v = struct.unpack_from('<h', data, p)[0]; p += 2
        elif t == 'C': v = bool(data[p]); p += 1
        elif t == 'I': v = struct.unpack_from('<i', data, p)[0]; p += 4
        elif t == 'F': v = struct.unpack_from('<f', data, p)[0]; p += 4
        elif t == 'D': v = struct.unpack_from('<d', data, p)[0]; p += 8
        elif t == 'L': v = struct.unpack_from('<q', data, p)[0]; p += 8
        elif t in _ARRAY_FMT: v, p = _read_array(data, p, t)
        elif t in 'SR':
            n = struct.unpack_from('<I', data, p)[0]; p += 4
            raw = data[p:p + n]; p += n
            v = raw.decode('utf8', 'replace').replace('\x00\x01', '::') if t == 'S' else raw
        else:
            raise ValueError('unknown property type %r at %d' % (t, p))
        props.append(v)
    return props, p

def _read_node(data, off):
    end_off, num_props, _ = struct.unpack_from('<III', data, off)
    off += 12
    name_len = data[off]; off += 1
    name = data[off:off + name_len].decode('utf8', 'replace'); off += name_len
    if end_off == 0:
        return None, 0
    props, off = _read_props(data, off, num_props)
    children = []
    while off < end_off - 13:
        child, off = _read_node(data, off)
        if child is None:
            break
        children.append(child)
    return Node(name, props, children), end_off

def load(path):
    data = open(path, 'rb').read()
    if not data.startswith(b'Kaydara FBX Binary'):
        raise ValueError('not a binary FBX')
    off, roots = 27, []
    while off < len(data) - 13:
        node, off = _read_node(data, off)
        if node is None:
            break
        roots.append(node)
    return Node('__root__', [], roots)

def prop70(node):
    """Flatten a Properties70 block into {name: value-or-tuple}."""
    out = {}
    props = node.find('Properties70')
    if props is None:
        return out
    for p in props.find_all('P'):
        vals = p.props[4:]
        out[p.props[0]] = vals[0] if len(vals) == 1 else tuple(vals)
    return out
