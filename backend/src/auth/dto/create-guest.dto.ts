import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateGuestDto {
  @IsUUID()
  installationKey!: string;

  @IsString()
  @MinLength(32)
  @MaxLength(512)
  credentialSecret!: string;
}
