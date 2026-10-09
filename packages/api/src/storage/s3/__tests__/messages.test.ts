import { FileSources } from 'librechat-data-provider';

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://bucket.s3.amazonaws.com/fresh?signed=true'),
}));

jest.mock('@librechat/data-schemas', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { refreshMessageFileUrls } from '../messages';

const expiredUrl = (key: string) => {
  const signedAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const date = signedAt.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  return `https://bucket.s3.amazonaws.com/${key}?X-Amz-Signature=abc&X-Amz-Date=${date}&X-Amz-Expires=1800`;
};

describe('refreshMessageFileUrls', () => {
  beforeAll(() => {
    process.env.AWS_REGION = 'us-east-1';
    process.env.AWS_BUCKET_NAME = 'test-bucket';
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('re-signs expired S3 links in files and attachments', async () => {
    const messages = [
      {
        messageId: 'm1',
        files: [{ file_id: 'f1', source: FileSources.s3, filepath: expiredUrl('images/u1/a.png') }],
      },
      {
        messageId: 'm2',
        attachments: [
          { file_id: 'f2', source: FileSources.s3, filepath: expiredUrl('images/u1/b.png') },
        ],
      },
    ];

    const result = await refreshMessageFileUrls(messages);

    expect(result).toBe(messages);
    expect(messages[0].files?.[0].filepath).toBe(
      'https://bucket.s3.amazonaws.com/fresh?signed=true',
    );
    expect(messages[1].attachments?.[0].filepath).toBe(
      'https://bucket.s3.amazonaws.com/fresh?signed=true',
    );
    expect(getSignedUrl).toHaveBeenCalledTimes(2);
  });

  it('leaves non-S3 files and messages without files alone', async () => {
    const messages = [
      { messageId: 'm1' },
      {
        messageId: 'm2',
        files: [{ file_id: 'f1', source: FileSources.local, filepath: '/images/a.png' }],
      },
      { messageId: 'm3', files: null },
    ];

    await refreshMessageFileUrls(messages);

    expect(messages[1].files?.[0].filepath).toBe('/images/a.png');
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  it('keeps the old link when signing fails', async () => {
    (getSignedUrl as jest.Mock).mockRejectedValueOnce(new Error('no credentials'));
    const filepath = expiredUrl('images/u1/a.png');
    const messages = [{ files: [{ source: FileSources.s3, filepath }] }];

    await refreshMessageFileUrls(messages);

    expect(messages[0].files[0].filepath).toBe(filepath);
  });
});
