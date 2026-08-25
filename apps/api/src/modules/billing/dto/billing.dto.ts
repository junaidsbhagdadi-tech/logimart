import { IsArray, IsIn, IsInt, IsISO8601, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class GenerateInvoiceDto {
  @IsInt() clientId!: number;
  @IsISO8601() periodStart!: string;
  @IsISO8601() periodEnd!: string;
}

/** Batch invoice run: one customer, a chosen set, or every eligible customer for the period. */
export class GenerateBatchDto {
  @IsIn(['SINGLE', 'MULTIPLE', 'ALL']) scope!: 'SINGLE' | 'MULTIPLE' | 'ALL';
  @IsOptional() @IsArray() @IsInt({ each: true }) clientIds?: number[]; // required for SINGLE/MULTIPLE
  @IsISO8601() periodStart!: string;
  @IsISO8601() periodEnd!: string;
}

export class DisputeDto {
  @IsInt() shipmentId!: number;
  @IsString() @MinLength(3) reason!: string;
}

export class PayDto {
  @IsNumber() @Min(0) amount!: number; // cash received
  @IsOptional() @IsNumber() @Min(0) tds?: number;
  @IsOptional() @IsNumber() @Min(0) other?: number;
  @IsOptional() @IsString() otherNote?: string;
}
