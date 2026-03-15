import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import { Response } from 'express';
import { MediaService } from './media.service';

@Controller('media')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Get(':key')
  async getMedia(@Param('key') key: string, @Res() res: Response) {
    const safeKey = (key || '').replace(/[^a-zA-Z0-9._-]/g, '');
    if (!safeKey) throw new NotFoundException();

    let obj: { stream: NodeJS.ReadableStream; contentType: string; contentLength: number | null };
    try {
      obj = await this.mediaService.getObjectStream(safeKey);
    } catch {
      throw new NotFoundException();
    }

    res.setHeader('Content-Type', obj.contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    if (obj.contentLength != null) {
      res.setHeader('Content-Length', String(obj.contentLength));
    }

    obj.stream.pipe(res);
  }
}
