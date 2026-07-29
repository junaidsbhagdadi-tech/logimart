import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsISO8601,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { ScanCheckpoint } from '@prisma/client';

export class ScanGpsDto {
  @IsNumber() lat!: number;
  @IsNumber() lng!: number;
}

export class ScanEventInputDto {
  /** Device-generated UUID — the idempotency key. */
  @IsUUID()
  clientEventId!: string;

  /** Scannable child identity (childId / barcodeValue). */
  @IsString()
  barcode!: string;

  @IsEnum(ScanCheckpoint)
  checkpoint!: ScanCheckpoint;

  @IsISO8601()
  scannedAt!: string;

  @IsOptional() @IsNumber() deviceSeq?: number;
  @IsOptional() @IsObject() @ValidateNested() @Type(() => ScanGpsDto) gps?: ScanGpsDto;
  @IsOptional() hubId?: number;
}

export class BulkSyncDto {
  @IsString()
  deviceId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => ScanEventInputDto)
  events!: ScanEventInputDto[];
}
