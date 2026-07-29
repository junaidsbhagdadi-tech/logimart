import { IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreatePodDto {
  @IsNumber() gpsLat!: number; // mandatory GPS at the delivery scan
  @IsNumber() gpsLng!: number;

  @IsInt() @Min(0) piecesDelivered!: number;

  @IsOptional() @IsString() signatureUrl?: string;
  @IsOptional() @IsString() stampPhotoUrl?: string; // corporate stamp photo
}
