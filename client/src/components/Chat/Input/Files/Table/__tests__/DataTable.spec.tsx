import { RecoilRoot } from 'recoil';
import userEvent from '@testing-library/user-event';
import { FileSources } from 'librechat-data-provider';
import { render, screen, within } from '@testing-library/react';
import type { TFile } from 'librechat-data-provider';
import DataTable from '../DataTable';
import { columns } from '../Columns';

const mockDeleteFiles = jest.fn();
const mockStartupConfig: { current: { interface?: { deletionLogNotice?: boolean } } } = {
  current: { interface: { deletionLogNotice: true } },
};

jest.mock('~/hooks/Files', () => ({
  useDeleteFilesFromTable: () => ({ deleteFiles: mockDeleteFiles }),
}));
jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({ data: mockStartupConfig.current }),
}));
jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

const file = {
  file_id: 'file-1',
  filename: 'notes.txt',
  filepath: '/files/notes.txt',
  type: 'text/plain',
  bytes: 10,
  source: FileSources.s3,
  user: 'user-1',
  object: 'file',
  usage: 0,
  embedded: false,
  updatedAt: '2026-10-01T00:00:00.000Z',
} as unknown as TFile;

const renderTable = () =>
  render(
    <RecoilRoot>
      <DataTable columns={columns} data={[file]} />
    </RecoilRoot>,
  );

describe('DataTable file deletion', () => {
  beforeEach(() => mockDeleteFiles.mockClear());

  it('asks before deleting, and notes that the study records are kept', async () => {
    const user = userEvent.setup();
    renderTable();

    await user.click(screen.getByRole('checkbox', { name: 'com_ui_select_all' }));
    await user.click(screen.getByRole('button', { name: 'com_ui_delete' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('com_ui_delete_files_confirm_title')).toBeInTheDocument();
    expect(within(dialog).getByText('com_ui_delete_log_notice')).toBeInTheDocument();
    expect(mockDeleteFiles).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'com_ui_delete' }));
    expect(mockDeleteFiles).toHaveBeenCalledWith(
      expect.objectContaining({ files: [expect.objectContaining({ file_id: 'file-1' })] }),
    );
  });

  it('deletes nothing when the user cancels', async () => {
    const user = userEvent.setup();
    renderTable();

    await user.click(screen.getByRole('checkbox', { name: 'com_ui_select_all' }));
    await user.click(screen.getByRole('button', { name: 'com_ui_delete' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'com_ui_cancel' }),
    );

    expect(mockDeleteFiles).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
