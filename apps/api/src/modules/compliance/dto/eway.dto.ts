import { IsNumber, IsOptional, IsPositive, IsString, MinLength } from 'class-validator';

export class GenerateEwayDto {
  @IsNumber() @IsPositive() declaredValue!: number; // taxable value of goods
  @IsString() @MinLength(4) vehicleNo!: string;
  @IsOptional() @IsString() hsnCode?: string;
  @IsOptional() @IsNumber() distanceKm?: number;
  @IsOptional() @IsString() consignorGstin?: string;
  @IsOptional() @IsString() consigneeGstin?: string;
}
