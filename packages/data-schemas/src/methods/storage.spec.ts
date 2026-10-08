import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createStorageMethods } from './storage';
import { createFileMethods } from './file';
import { createModels } from '~/models';

let mongoServer: MongoMemoryServer;
let modelsToCleanup: string[] = [];
let storage: ReturnType<typeof createStorageMethods>;
let files: ReturnType<typeof createFileMethods>;

const addFile = (user: mongoose.Types.ObjectId, bytes: number) =>
  files.createFile({
    file_id: uuidv4(),
    user,
    filename: 'file.pdf',
    filepath: '/uploads/file.pdf',
    type: 'application/pdf',
    bytes,
  });

describe('Storage Methods', () => {
  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
    const models = createModels(mongoose);
    modelsToCleanup = Object.keys(models);
    Object.assign(mongoose.models, models);
    storage = createStorageMethods(mongoose);
    files = createFileMethods(mongoose);
  });

  afterAll(async () => {
    await mongoose.connection.collections.files?.deleteMany({});
    for (const modelName of modelsToCleanup) {
      delete mongoose.models[modelName];
    }
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  it("adds up the bytes of only the user's own files", async () => {
    const user = new mongoose.Types.ObjectId();
    const other = new mongoose.Types.ObjectId();
    await addFile(user, 1000);
    await addFile(user, 2500);
    await addFile(other, 999_999);

    await expect(storage.getUserStorageBytes(user.toString())).resolves.toBe(3500);
  });

  it('reports 0 for a user without files', async () => {
    const user = new mongoose.Types.ObjectId();
    await expect(storage.getUserStorageBytes(user.toString())).resolves.toBe(0);
  });
});
