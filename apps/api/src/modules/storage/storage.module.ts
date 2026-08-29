import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';

/** Global so any service (lifecycle, pods, …) can inject StorageService without wiring imports. */
@Global()
@Module({ providers: [StorageService], exports: [StorageService] })
export class StorageModule {}
