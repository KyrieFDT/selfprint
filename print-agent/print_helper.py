"""
自助打印系统 - 打印助手
通过 win32print/win32api 直接操控 Windows 打印机驱动
用法: python print_helper.py <file> --printer <name> --color bw|color --duplex single|double --copies 1
"""

import sys
import os
import json
import argparse

def main():
    parser = argparse.ArgumentParser(description='打印助手')
    parser.add_argument('file', help='要打印的文件路径')
    parser.add_argument('--printer', '-p', default=None, help='打印机名称 (默认: 系统默认打印机)')
    parser.add_argument('--color', '-c', default='bw', choices=['bw', 'color'], help='色彩模式')
    parser.add_argument('--duplex', '-d', default='single', choices=['single', 'double'], help='单双面')
    parser.add_argument('--copies', '-n', type=int, default=1, help='份数')
    args = parser.parse_args()

    file_path = os.path.abspath(args.file)
    if not os.path.exists(file_path):
        output({'success': False, 'error': f'文件不存在: {file_path}'})
        sys.exit(1)

    try:
        import win32print
        import win32api
        import win32con
    except ImportError:
        output({'success': False, 'error': '请先安装 pywin32: pip install pywin32'})
        sys.exit(1)

    try:
        # 确定打印机
        printer_name = args.printer or win32print.GetDefaultPrinter()
        print(f'[Print] 打印机: {printer_name}', file=sys.stderr)

        # 尝试修改 DEVMODE (需要足够权限)，权限不足则跳过直接打印
        devmode_ok = False
        for access in [win32print.PRINTER_ACCESS_ADMINISTER, win32print.PRINTER_ACCESS_USE]:
            try:
                pHandle = win32print.OpenPrinter(printer_name, {"DesiredAccess": access})
                properties = win32print.GetPrinter(pHandle, 2)
                pDevMode = properties['pDevMode']

                if args.color == 'color':
                    pDevMode.Color = win32con.DMCOLOR_COLOR
                else:
                    pDevMode.Color = win32con.DMCOLOR_MONOCHROME

                pDevMode.Copies = args.copies

                if args.duplex == 'double':
                    pDevMode.Duplex = win32con.DMDUP_VERTICAL
                else:
                    pDevMode.Duplex = win32con.DMDUP_SIMPLEX

                pDevMode.Orientation = win32con.DMORIENT_PORTRAIT

                properties['pDevMode'] = pDevMode
                win32print.SetPrinter(pHandle, 2, properties, 0)
                win32print.ClosePrinter(pHandle)
                devmode_ok = True
                print(f'[Print] DEVMODE已设置: color={args.color} duplex={args.duplex} copies={args.copies}', file=sys.stderr)
                break
            except Exception as e:
                try: win32print.ClosePrinter(pHandle)
                except: pass
                print(f'[Print] 权限级别 {access} 失败: {e}', file=sys.stderr)
                continue

        if not devmode_ok:
            print(f'[Print] 无法修改打印机设置, 将使用系统默认设置打印', file=sys.stderr)

        # 执行打印
        print(f'[Print] 正在打印: {file_path}', file=sys.stderr)
        win32api.ShellExecute(
            0,
            "print",
            file_path,
            None,
            ".",
            0  # SW_HIDE
        )
        print(f'[Print] ShellExecute 已调用', file=sys.stderr)

        output({'success': True, 'method': 'win32print', 'printer': printer_name, 'devmode_set': devmode_ok})

    except Exception as e:
        output({'success': False, 'error': str(e)})
        sys.exit(1)


def output(data):
    """输出 JSON 到 stdout，方便 Node.js 解析"""
    print(json.dumps(data, ensure_ascii=False))


if __name__ == '__main__':
    main()
