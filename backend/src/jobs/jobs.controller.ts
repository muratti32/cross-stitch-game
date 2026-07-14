import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';

import { CreateDemoJobDto } from './dto/create-demo-job.dto';
import { JobsService } from './jobs.service';
import { CreatedDemoJob, DemoJobView } from './jobs.types';

@Controller('demo-jobs')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  createDemoJob(@Body() body: CreateDemoJobDto): Promise<CreatedDemoJob> {
    return this.jobsService.createDemoJob(body.message);
  }

  @Get(':id')
  async getDemoJob(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<DemoJobView> {
    const job = await this.jobsService.getDemoJob(id);
    if (job === null) {
      throw new NotFoundException(`Demo Processing Job ${id} was not found`);
    }
    return job;
  }
}

