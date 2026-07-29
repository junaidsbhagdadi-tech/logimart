import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateNoteDto {
  @IsInt() clientId!: number;
  @IsIn(['DEBIT', 'CREDIT']) kind!: 'DEBIT' | 'CREDIT';
  @IsString() reason!: string; // weight_discrepancy | demurrage | rate_correction | damage_claim | goodwill | billing_error | other
  @IsNumber() @Min(0.01) subtotal!: number;
  @IsOptional() @IsString() narration?: string;
  @IsOptional() @IsInt() shipmentId?: number;
  @IsOptional() @IsInt() invoiceId?: number;
  @IsOptional() @IsBoolean() applyGst?: boolean;
}
