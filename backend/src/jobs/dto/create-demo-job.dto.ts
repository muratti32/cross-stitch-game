import { IsString, Length } from 'class-validator';

export class CreateDemoJobDto {
  @IsString()
  @Length(1, 1_000)
  message!: string;
}

