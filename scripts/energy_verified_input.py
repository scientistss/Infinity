"""Per-call verified inputs, not native or release acceptance.

Capture and seal observed consistent bytes. This is not an OS snapshot and cannot
prove that an unobserved ABA edit never happened. No process/global input cache.

Repository discovery rechecks HEAD, resolved Git/common/object-store identity and
the metadata of Git-directory config/config.worktree, common-directory config,
and objects/info/alternates. These fixed control files must not be symlinks,
including dangling symlinks. Only their lstat metadata is inspected here; their
contents are never read or logged by Python. Arbitrary included configuration
files are not monitored. RawStore's empty configuration and independently checked
object IDs are the raw-byte interpretation boundary, not a claim that every
effective Git configuration setting is unchanged during capture.
"""
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
from types import MappingProxyType

OID = re.compile(r'[0-9a-f]{40}')
SOURCE_AREAS = ('src', 'public', 'scripts', 'tests', '.github')


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def object_oid(kind, raw):
    return hashlib.sha1(kind.encode() + b' ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()


def clean_environment():
    # Do not inspect, copy or log authentication/configuration values.
    return {'PATH': os.defpath, 'LANG': 'C', 'LC_ALL': 'C',
            'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null',
            'GIT_CONFIG_SYSTEM': '/dev/null', 'GIT_NO_REPLACE_OBJECTS': '1'}


def git(root, *args):
    return subprocess.check_output(['git', '--no-replace-objects', '-C', str(root), *args],
                                   env=clean_environment(), stderr=subprocess.PIPE)


def stamp(path):
    value = path.lstat()
    return (value.st_dev, value.st_ino, value.st_mode, value.st_size,
            value.st_mtime_ns, value.st_ctime_ns)


def control_stamp(path):
    # exists() follows links and would hide dangling control-file symlinks.
    try:
        value = stamp(path)
    except FileNotFoundError:
        return None
    assert not stat.S_ISLNK(value[2]), ('Control file symlink forbidden', str(path))
    return value


def controls(root):
    head = git(root, 'rev-parse', '--verify', 'HEAD^{commit}').decode().strip()
    assert OID.fullmatch(head), 'Full candidate commit required'
    assert git(root, 'rev-parse', '--show-object-format').strip() == b'sha1'
    assert not git(root, 'for-each-ref', '--format=%(refname)', 'refs/replace').strip(), 'Replacement refs forbidden during capture'
    git_dir = Path(git(root, 'rev-parse', '--absolute-git-dir').decode().strip()).resolve()
    common = Path(git(root, 'rev-parse', '--path-format=absolute', '--git-common-dir').decode().strip()).resolve()
    objects = Path(git(root, 'rev-parse', '--path-format=absolute', '--git-path', 'objects').decode().strip()).resolve()
    # Observe metadata only. Never read or print config contents or secrets.
    paths = {git_dir/'config', git_dir/'config.worktree', common/'config', objects/'info'/'alternates'}
    metadata = tuple((str(path), control_stamp(path)) for path in sorted(paths))
    return head, str(git_dir), str(common), str(objects), metadata


class RawStore:
    """Raw reads through our empty Git config, with no replacement refs."""
    def __init__(self, objects):
        self.temp = tempfile.TemporaryDirectory(prefix='verified-input-git-')
        self.directory = Path(self.temp.name)
        (self.directory/'objects').mkdir()
        (self.directory/'refs').mkdir()
        (self.directory/'HEAD').write_text('ref: refs/heads/unborn\n')
        self.env = clean_environment()
        self.env['GIT_OBJECT_DIRECTORY'] = objects

    def close(self):
        self.temp.cleanup()

    def read(self, identifiers):
        identifiers = tuple(identifiers)
        if not identifiers:
            return {}
        assert len(set(identifiers)) == len(identifiers)
        assert all(OID.fullmatch(oid) for oid in identifiers), 'Malformed object request'
        raw = subprocess.check_output(['git', '--no-replace-objects', '--git-dir='+str(self.directory),
                                       'cat-file', '--batch'], env=self.env,
                                      input=('\n'.join(identifiers)+'\n').encode(), stderr=subprocess.PIPE)
        result = {}
        offset = 0
        for expected in identifiers:
            end = raw.index(b'\n', offset)
            header = raw[offset:end].decode().split()
            assert len(header) == 3 and header[0] == expected, 'Missing or substituted object'
            oid, kind, size = header
            assert kind in ('commit', 'tree', 'blob') and size.isdecimal(), 'Unexpected object type'
            offset = end + 1
            data = raw[offset:offset+int(size)]
            offset += int(size)
            assert len(data) == int(size) and raw[offset:offset+1] == b'\n', 'Truncated raw object'
            offset += 1
            assert object_oid(kind, data) == oid, 'Raw object hash mismatch'
            result[oid] = (kind, data)
        assert offset == len(raw), 'Unexpected raw object data'
        return result


def tree_entries(raw):
    result = []
    offset = 0
    seen = set()
    while offset < len(raw):
        end = raw.index(b'\0', offset)
        mode, name = raw[offset:end].split(b' ', 1)
        name = name.decode('utf-8')
        assert name and name not in ('.', '..') and '/' not in name and name not in seen, 'Invalid tree path'
        seen.add(name)
        value = raw[end+1:end+21]
        assert len(value) == 20, 'Truncated tree entry'
        result.append((mode.decode(), name, value.hex()))
        offset = end+21
    return result


def commit_tree(raw):
    first = raw.split(b'\n', 1)[0]
    assert first.startswith(b'tree ') and OID.fullmatch(first[5:].decode()), 'Invalid commit tree'
    return first[5:].decode()


def inventory(tree, objects, prefix=''):
    kind, raw = objects[tree]
    assert kind == 'tree'
    result = {}
    for mode, name, oid in tree_entries(raw):
        path = prefix+name
        if mode == '40000':
            result.update(inventory(oid, objects, path+'/'))
        else:
            assert mode in ('100644', '100755'), ('Unsupported committed mode', path)
            result[path] = (mode, oid)
    return result


def scan_current(root, expected, objects):
    files, metadata = {}, {}
    for path, (mode, oid) in sorted(expected.items()):
        local = root/path
        before = stamp(local)
        assert stat.S_ISREG(before[2]) and not local.is_symlink(), ('Ordinary current source required', path)
        assert bool(before[2] & 0o111) == (mode == '100755'), ('Current mode drift', path)
        raw = local.read_bytes()
        assert stamp(local) == before, ('Source changed during read', path)
        assert objects[oid] == ('blob', raw), ('Current bytes differ from committed object', path)
        files[path] = raw
        metadata[path] = before
    actual = set()
    for area in SOURCE_AREAS:
        base = root/area
        assert base.is_dir() and not base.is_symlink(), ('Invalid source root', area)
        for local in base.rglob('*'):
            path = local.relative_to(root).as_posix()
            assert not local.is_symlink(), ('Source symlink', path)
            if area not in ('src', 'public') and ('__pycache__' in local.parts or local.suffix == '.pyc'):
                continue
            if local.is_file():
                actual.add(path)
            else:
                assert local.is_dir(), ('Irregular source path', path)
    expected_sources = {path for path in expected if path.startswith(tuple(area+'/' for area in SOURCE_AREAS))}
    assert actual == expected_sources, 'New or missing source file'
    return files, metadata


def manifest(candidate, trees, files, objects, histories):
    return {'schema': 'infinity-verified-input-v1', 'candidate': candidate,
            'trees': dict(trees), 'files': {path: sha(raw) for path, raw in files.items()},
            'objects': {oid: [kind, sha(raw)] for oid, (kind, raw) in objects.items()},
            'history': {reference: dict(entries) for reference, entries in histories.items()}}


@dataclass(frozen=True)
class VerifiedInput:
    candidate: str
    trees: object
    files: object
    objects: object
    histories: object
    digest: str

    def verify_seal(self):
        assert sha(canonical(manifest(self.candidate, self.trees, self.files, self.objects, self.histories))) == self.digest, 'Input seal mismatch'
        for oid, (kind, raw) in self.objects.items():
            assert object_oid(kind, raw) == oid, 'Sealed object mismatch'
        for reference, entries in self.histories.items():
            assert commit_tree(self.objects[reference][1]) == self.trees[reference]
            assert dict(entries) == inventory(self.trees[reference], self.objects), 'Sealed path or mode mismatch'
        assert set(self.files) == set(self.histories[self.candidate]), 'Sealed source inventory mismatch'
        for path, raw in self.files.items():
            _, oid = self.histories[self.candidate][path]
            assert self.objects[oid] == ('blob', raw), ('Sealed current source mismatch', path)

    def historical(self, reference, path):
        mode, oid = self.histories[reference][path]
        assert mode == '100644', ('Ordinary historical projection required', path)
        assert self.objects[oid][0] == 'blob'
        return self.objects[oid][1]


def capture(root, requests, candidate=None):
    root = Path(root)
    assert root.is_absolute() and root == root.resolve(), 'Canonical input repository required'
    before = controls(root)
    candidate = before[0] if candidate is None else candidate
    assert OID.fullmatch(candidate) and candidate == before[0], 'Exact current full commit required'
    references = set(requests) | {candidate}
    assert all(OID.fullmatch(value) for value in references)
    store = RawStore(before[3])
    try:
        objects = store.read(sorted(references))
        assert all(objects[ref][0] == 'commit' for ref in references), 'Commit object required'
        trees = {ref: commit_tree(objects[ref][1]) for ref in references}
        pending = set(trees.values())
        while pending:
            new = store.read(sorted(pending))
            assert all(kind == 'tree' for kind, _ in new.values()), 'Raw tree required'
            objects.update(new)
            pending = {oid for _, raw in new.values() for mode, _, oid in tree_entries(raw)
                       if mode == '40000' and oid not in objects}
        histories = {ref: inventory(tree, objects) for ref, tree in trees.items()}
        blobs = {oid for _, oid in histories[candidate].values()}
        for ref, paths in requests.items():
            for path in paths:
                assert path in histories[ref], ('Historical path missing', path)
                mode, oid = histories[ref][path]
                assert mode == '100644', ('Ordinary historical path required', path)
                blobs.add(oid)
        new = store.read(sorted(blobs - set(objects)))
        assert all(kind == 'blob' for kind, _ in new.values()), 'Raw blob required'
        objects.update(new)
        files, metadata = scan_current(root, histories[candidate], objects)
        # Sealing revalidates observable source, object and repository identity.
        assert store.read(sorted(objects)) == objects, 'Objects changed before sealing'
        again, after_metadata = scan_current(root, histories[candidate], objects)
        assert (again, after_metadata) == (files, metadata), 'Current source changed before sealing'
        assert controls(root) == before, 'Repository controls changed before sealing'
        histories = MappingProxyType({ref: MappingProxyType(entries) for ref, entries in histories.items()})
        trees, files, objects = map(MappingProxyType, (trees, files, objects))
        digest = sha(canonical(manifest(candidate, trees, files, objects, histories)))
        value = VerifiedInput(candidate, trees, files, objects, histories, digest)
        value.verify_seal()
        return value
    finally:
        store.close()
