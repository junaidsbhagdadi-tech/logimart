import { IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateClaimDto {
  @IsOptional() @IsString() awb?: string;
  @IsOptional() @IsInt() clientId?: number;
  @IsIn(['damage', 'loss', 'shortage', 'delay']) type!: 'damage' | 'loss' | 'shortage' | 'delay';
  @IsNumber() @Min(0.01) claimedAmount!: number;
  @IsOptional() @IsNumber() declaredValue?: number;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsArray() attachments?: { name?: string; dataUrl: string }[]; // #15 — pics / email comms
}

export class ReviewClaimDto {
  @IsIn(['under_review', 'rejected']) status!: 'under_review' | 'rejected';
  @IsOptional() @IsString() resolution?: string;
}

export class SettleClaimDto {
  @IsNumber() @Min(0.01) approvedAmount!: number;
  @IsOptional() @IsString() resolution?: string;
}
