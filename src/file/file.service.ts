import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { promises as fs } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { variantPathsFor } from './image-variants';

const UPLOAD_DIR = join(process.cwd(), 'uploads');

@Injectable()
export class FileService {
  private async ensureUploadDir(): Promise<void> {
    try {
      await fs.access(UPLOAD_DIR);
    } catch {
      await fs.mkdir(UPLOAD_DIR, { recursive: true });
    }
  }

  async saveFile(file: Express.Multer.File): Promise<string> {
    await this.ensureUploadDir();

    const fileExtension =
      file.originalname.match(/\.([a-z0-9]{1,10})$/i)?.[1].toLowerCase() ||
      'bin';
    const fileName = `${randomUUID()}.${fileExtension}`;
    const filePath = join(UPLOAD_DIR, fileName);

    try {
      await fs.writeFile(filePath, file.buffer);
      return `/uploads/${fileName}`;
    } catch {
      throw new InternalServerErrorException('Failed to save file');
    }
  }

  async deleteFile(filePath: string): Promise<void> {
    if (!filePath || !/^\/uploads\/[a-z0-9][a-z0-9._-]*$/i.test(filePath)) {
      return;
    }

    const fileName = filePath.replace('/uploads/', '');
    const fullPath = join(UPLOAD_DIR, fileName);

    try {
      await fs.unlink(fullPath);
    } catch {
      // Файл может уже не существовать
    }

    await Promise.all(
      variantPathsFor(UPLOAD_DIR, fileName).map((path) =>
        fs.unlink(path).catch(() => undefined),
      ),
    );
  }

  async deleteFiles(filePaths: string[]): Promise<void> {
    await Promise.all(filePaths.map((path) => this.deleteFile(path)));
  }
}
