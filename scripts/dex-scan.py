#!/usr/bin/env python3
"""Count the classes DEFINED in every classes*.dex of an APK or AAB, grouped by package prefix (P8a, loyalty-cards).

Usage: python3 -I scripts/dex-scan.py <file.apk|file.aab> [extra/prefix/ ...]
Reads the dex class_defs table (not strings), so a class that is only referenced does not count. Prints one line per
watched prefix plus the total class count and the ML Kit prefixes. Nothing is extracted to disk.
"""
import struct
import sys
import zipfile

WATCH = [
    "com/google/firebase/",
    "com/google/android/datatransport/",
    "com/google/android/gms/",
    "com/android/installreferrer/",
    "expo/modules/notifications/",
    "expo/modules/application/",
    "me/leolin/shortcutbadger/",
    "com/google/mlkit/",
    "com/google/android/odml/",
    "expo/modules/devlauncher/",
    "expo/modules/devmenu/",
    "expo/modules/camera/",
    "androidx/camera/",
    "expo/modules/cardswidget/",
]


def uleb(data, pos):
    result = shift = 0
    while True:
        b = data[pos]
        pos += 1
        result |= (b & 0x7F) << shift
        if not b & 0x80:
            return result, pos
        shift += 7


def defined_classes(data):
    str_size, str_off = struct.unpack_from("<II", data, 0x38)
    type_size, type_off = struct.unpack_from("<II", data, 0x40)
    cdef_size, cdef_off = struct.unpack_from("<II", data, 0x60)
    out = []
    for i in range(cdef_size):
        (class_idx,) = struct.unpack_from("<I", data, cdef_off + i * 32)
        (descr_idx,) = struct.unpack_from("<I", data, type_off + class_idx * 4)
        (data_off,) = struct.unpack_from("<I", data, str_off + descr_idx * 4)
        _, pos = uleb(data, data_off)
        end = data.index(b"\x00", pos)
        out.append(data[pos:end].decode("utf-8", "replace"))
    return out


def main():
    path = sys.argv[1]
    watch = WATCH + sys.argv[2:]
    names = []
    with zipfile.ZipFile(path) as z:
        dex = sorted(n for n in z.namelist() if n.endswith(".dex") and "classes" in n.split("/")[-1])
        for n in dex:
            names += defined_classes(z.read(n))
        flagged = [n for n in z.namelist() if any(k in n.lower() for k in ("firebase", "installreferrer", "play-services", "gms"))]
    print(f"{path}: {len(dex)} dex files, {len(names)} classes defined")
    for prefix in watch:
        count = sum(1 for d in names if d.startswith("L" + prefix))
        print(f"  {prefix:<42}{count}")
    print(f"  zip entries naming firebase/installreferrer/play-services/gms: {len(flagged)}")
    for n in flagged[:10]:
        print("    ", n)


if __name__ == "__main__":
    main()
