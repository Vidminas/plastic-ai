import { getFileExtension, isAllowedFileExtension, normalizeFileExtensions } from '../src/uploads';
import { mergeFileConfig, fileConfigSchema } from '../src/file-config';

describe('upload extension policy', () => {
  const allowed = ['pdf', '.DOCX', 'md'];

  it('reads the extension after the last dot, ignoring folders and case', () => {
    expect(getFileExtension('Report.Final.PDF')).toBe('pdf');
    expect(getFileExtension('notes/README.md')).toBe('md');
    expect(getFileExtension('C:\\docs\\plan.docx')).toBe('docx');
    expect(getFileExtension('Makefile')).toBe('');
    expect(getFileExtension('.env')).toBe('');
  });

  it('allows listed extensions in any case and with or without a dot', () => {
    expect(isAllowedFileExtension('a.pdf', allowed)).toBe(true);
    expect(isAllowedFileExtension('a.DocX', allowed)).toBe(true);
    expect(normalizeFileExtensions(allowed)).toEqual(['pdf', 'docx', 'md']);
  });

  it('refuses other extensions, names without one, and disguised double extensions', () => {
    expect(isAllowedFileExtension('song.mp3', allowed)).toBe(false);
    expect(isAllowedFileExtension('script', allowed)).toBe(false);
    expect(isAllowedFileExtension('invoice.pdf.exe', allowed)).toBe(false);
  });

  it('allows everything without a list', () => {
    expect(isAllowedFileExtension('anything.zip', undefined)).toBe(true);
  });
});

describe('mergeFileConfig upload limits', () => {
  it('normalizes extensions and converts the storage limit to bytes', () => {
    const merged = mergeFileConfig(
      fileConfigSchema.parse({ allowedExtensions: ['.PDF', 'md'], userStorageLimit: 2048 }),
    );
    expect(merged.allowedExtensions).toEqual(['pdf', 'md']);
    expect(merged.userStorageLimit).toBe(2048 * 1024 * 1024);
  });

  it('leaves both unset by default', () => {
    const merged = mergeFileConfig(fileConfigSchema.parse({}));
    expect(merged.allowedExtensions).toBeUndefined();
    expect(merged.userStorageLimit).toBeUndefined();
  });
});
