import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { existsSync } from 'fs';
import { PrismaModule } from './prisma/prisma.module';
import { AppController } from './app.controller';
import { AuthModule } from './modules/auth/auth.module';
import { ShipmentsModule } from './modules/shipments/shipments.module';
import { LabelsModule } from './modules/labels/labels.module';
import { ScansModule } from './modules/scans/scans.module';
import { PodsModule } from './modules/pods/pods.module';
import { BillingModule } from './modules/billing/billing.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ComplianceModule } from './modules/compliance/compliance.module';
import { TrackingModule } from './modules/tracking/tracking.module';
import { CustomersModule } from './modules/customers/customers.module';
import { RateCardsModule } from './modules/ratecards/ratecards.module';
import { StatsModule } from './modules/stats/stats.module';
import { ManifestsModule } from './modules/manifests/manifests.module';
import { PickupsModule } from './modules/pickups/pickups.module';
import { UsersModule } from './modules/users/users.module';
import { PincodesModule } from './modules/pincodes/pincodes.module';
import { HubsModule } from './modules/hubs/hubs.module';
import { MastersModule } from './modules/masters/masters.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { FeedbackModule } from './modules/feedback/feedback.module';
import { RiderModule } from './modules/rider/rider.module';
import { VendorsModule } from './modules/vendors/vendors.module';
import { CrmModule } from './modules/crm/crm.module';
import { TaxModule } from './modules/tax/tax.module';
import { NotesModule } from './modules/notes/notes.module';
import { ClaimsModule } from './modules/claims/claims.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { AuditModule } from './modules/audit/audit.module';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditInterceptor } from './modules/audit/audit.interceptor';

// Built web portal lives at apps/web/dist. At runtime __dirname = apps/api/dist,
// so the portal is two levels up then into web/dist.
const webDist = join(__dirname, '..', '..', 'web', 'dist');

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Serve the React portal for all non-API routes (SPA fallback to index.html).
    // /api/* and /health are excluded so they reach the controllers below.
    ...(existsSync(webDist)
      ? [
          ServeStaticModule.forRoot({
            rootPath: webDist,
            exclude: ['/api/(.*)', '/health'],
          }),
        ]
      : []),
    PrismaModule,
    AuthModule,
    ShipmentsModule,
    LabelsModule,
    ScansModule,
    PodsModule,
    BillingModule,
    NotificationsModule,
    ComplianceModule,
    TrackingModule,
    CustomersModule,
    RateCardsModule,
    StatsModule,
    ManifestsModule,
    PickupsModule,
    UsersModule,
    PincodesModule,
    HubsModule,
    MastersModule,
    UploadsModule,
    FeedbackModule,
    RiderModule,
    VendorsModule,
    CrmModule,
    TaxModule,
    NotesModule,
    ClaimsModule,
    DocumentsModule,
    AuditModule,
  ],
  controllers: [AppController],
  providers: [{ provide: APP_INTERCEPTOR, useClass: AuditInterceptor }],
})
export class AppModule {}
