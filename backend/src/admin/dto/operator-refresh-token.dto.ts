import { IsString, Length } from 'class-validator';

export class OperatorRefreshTokenDto {
  @IsString()
  @Length(1, 512)
  refreshToken!: string;
}
