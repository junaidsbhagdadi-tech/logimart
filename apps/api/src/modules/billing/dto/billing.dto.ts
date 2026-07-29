import { IsInt, IsISO8601, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class GenerateInvoiceDto {
  @IsInt() clientId!: number;
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
