import { IsIn } from 'class-validator';

export class RequestAccountDeletionDto {
  @IsIn(['DELETE'])
  confirmation!: 'DELETE';
}
