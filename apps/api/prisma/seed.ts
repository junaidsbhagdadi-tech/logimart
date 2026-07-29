import { PrismaClient, UserRole, ServiceMode } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // ---- Hubs ----
  const blr = await prisma.hub.upsert({
    where: { code: 'BLR' },
    update: {},
    create: { code: 'BLR', name: 'Bangalore Hub', zone: 'SOUTH' },
  });
  const hyd = await prisma.hub.upsert({
    where: { code: 'HYD' },
    update: {},
    create: { code: 'HYD', name: 'Hyderabad Hub', zone: 'SOUTH' },
  });

  // ---- Demo B2B client ----
  const client = await prisma.b2bClient.upsert({
    where: { accountCode: 'DEMO001' },
    update: {},
    create: {
      legalName: 'Demo Corp Pvt Ltd',
      accountCode: 'DEMO001',
      creditLimit: '500000.00',
      creditDays: 30,
    },
  });

  // ---- Rate card (BLR South -> HYD South, Road PTL) ----
  await prisma.rateCard.upsert({
    where: {
      clientId_originZone_destZone_serviceMode_effectiveFrom: {
        clientId: client.id,
        originZone: 'SOUTH',
        destZone: 'SOUTH',
        serviceMode: ServiceMode.ROAD_PTL,
        effectiveFrom: new Date('2026-01-01'),
      },
    },
    update: {},
    create: {
      clientId: client.id,
      originZone: 'SOUTH',
      destZone: 'SOUTH',
      serviceMode: ServiceMode.ROAD_PTL,
      perKgRate: '12.50',
      minCharge: '150.00',
      fuelPct: '8.00',
      effectiveFrom: new Date('2026-01-01'),
    },
  });

  // ---- Users (one per role) ----
  const pwd = await bcrypt.hash('akul1234', 10);
  const users: Array<[string, string, UserRole, bigint | null, bigint | null]> = [
    ['Sys Admin', 'admin@akullogistics.com', UserRole.SYS_ADMIN, null, null],
    ['Hub Manager', 'hub@akullogistics.com', UserRole.HUB_MANAGER, null, blr.id],
    ['Warehouse', 'warehouse@akullogistics.com', UserRole.WAREHOUSE_HANDLER, null, blr.id],
    ['Driver', 'driver@akullogistics.com', UserRole.DRIVER, null, blr.id],
    ['Finance', 'finance@akullogistics.com', UserRole.FINANCE_EXEC, null, null],
    ['Client Admin', 'client@demo.com', UserRole.CLIENT_ADMIN, client.id, null],
  ];
  for (const [fullName, email, role, clientId, hubId] of users) {
    await prisma.user.upsert({
      where: { email },
      update: {},
      create: { fullName, email, passwordHash: pwd, role, clientId, hubId },
    });
  }

  // ---- Pincode directory (Tier 1/2/3 cities, region-classified) ----
  type P = [string, string, string, 'NORTH' | 'SOUTH' | 'EAST' | 'WEST' | 'NORTHEAST', number, boolean?];
  const pins: P[] = [
    // Tier 1 (metros)
    ['400001', 'Mumbai', 'Maharashtra', 'WEST', 1], ['110001', 'New Delhi', 'Delhi', 'NORTH', 1],
    ['560001', 'Bengaluru', 'Karnataka', 'SOUTH', 1], ['500001', 'Hyderabad', 'Telangana', 'SOUTH', 1],
    ['600001', 'Chennai', 'Tamil Nadu', 'SOUTH', 1], ['700001', 'Kolkata', 'West Bengal', 'EAST', 1],
    ['411001', 'Pune', 'Maharashtra', 'WEST', 1], ['380001', 'Ahmedabad', 'Gujarat', 'WEST', 1],
    // Tier 2
    ['302001', 'Jaipur', 'Rajasthan', 'WEST', 2], ['226001', 'Lucknow', 'Uttar Pradesh', 'NORTH', 2],
    ['440001', 'Nagpur', 'Maharashtra', 'WEST', 2], ['452001', 'Indore', 'Madhya Pradesh', 'WEST', 2],
    ['462001', 'Bhopal', 'Madhya Pradesh', 'WEST', 2], ['395001', 'Surat', 'Gujarat', 'WEST', 2],
    ['641001', 'Coimbatore', 'Tamil Nadu', 'SOUTH', 2], ['682001', 'Kochi', 'Kerala', 'SOUTH', 2],
    ['530001', 'Visakhapatnam', 'Andhra Pradesh', 'SOUTH', 2], ['520001', 'Vijayawada', 'Andhra Pradesh', 'SOUTH', 2],
    ['160017', 'Chandigarh', 'Chandigarh', 'NORTH', 2], ['141001', 'Ludhiana', 'Punjab', 'NORTH', 2],
    ['208001', 'Kanpur', 'Uttar Pradesh', 'NORTH', 2], ['390001', 'Vadodara', 'Gujarat', 'WEST', 2],
    ['800001', 'Patna', 'Bihar', 'EAST', 2], ['751001', 'Bhubaneswar', 'Odisha', 'EAST', 2],
    ['781001', 'Guwahati', 'Assam', 'NORTHEAST', 2], ['834001', 'Ranchi', 'Jharkhand', 'EAST', 2],
    ['492001', 'Raipur', 'Chhattisgarh', 'WEST', 2], ['248001', 'Dehradun', 'Uttarakhand', 'NORTH', 2],
    ['570001', 'Mysuru', 'Karnataka', 'SOUTH', 2], ['575001', 'Mangaluru', 'Karnataka', 'SOUTH', 2],
    ['625001', 'Madurai', 'Tamil Nadu', 'SOUTH', 2], ['695001', 'Thiruvananthapuram', 'Kerala', 'SOUTH', 2],
    ['143001', 'Amritsar', 'Punjab', 'NORTH', 2], ['221001', 'Varanasi', 'Uttar Pradesh', 'NORTH', 2],
    ['580001', 'Hubballi', 'Karnataka', 'SOUTH', 2], ['360001', 'Rajkot', 'Gujarat', 'WEST', 2],
    // Tier 3
    ['590001', 'Belagavi', 'Karnataka', 'SOUTH', 3], ['636001', 'Salem', 'Tamil Nadu', 'SOUTH', 3],
    ['506001', 'Warangal', 'Telangana', 'SOUTH', 3], ['522001', 'Guntur', 'Andhra Pradesh', 'SOUTH', 3],
    ['305001', 'Ajmer', 'Rajasthan', 'WEST', 3], ['324001', 'Kota', 'Rajasthan', 'WEST', 3],
    ['243001', 'Bareilly', 'Uttar Pradesh', 'NORTH', 3], ['144001', 'Jalandhar', 'Punjab', 'NORTH', 3],
    ['171001', 'Shimla', 'Himachal Pradesh', 'NORTH', 3, true], ['313001', 'Udaipur', 'Rajasthan', 'WEST', 3],
    ['734001', 'Siliguri', 'West Bengal', 'EAST', 3], ['826001', 'Dhanbad', 'Jharkhand', 'EAST', 3],
    ['753001', 'Cuttack', 'Odisha', 'EAST', 3], ['495001', 'Bilaspur', 'Chhattisgarh', 'WEST', 3],
    ['795001', 'Imphal', 'Manipur', 'NORTHEAST', 3, true], ['799001', 'Agartala', 'Tripura', 'NORTHEAST', 3, true],
    ['793001', 'Shillong', 'Meghalaya', 'NORTHEAST', 3, true], ['786001', 'Dibrugarh', 'Assam', 'NORTHEAST', 3, true],
    ['791111', 'Itanagar', 'Arunachal Pradesh', 'NORTHEAST', 3, true], ['796001', 'Aizawl', 'Mizoram', 'NORTHEAST', 3, true],
    ['797001', 'Kohima', 'Nagaland', 'NORTHEAST', 3, true], ['737101', 'Gangtok', 'Sikkim', 'NORTHEAST', 3, true],
  ];
  await prisma.pincode.createMany({
    data: pins.map(([pincode, city, state, region, tier, isOda]) => ({ pincode, city, state, region: region as any, tier, isOda: !!isOda })),
    skipDuplicates: true,
  });

  console.log(`Seed complete. ${pins.length} pincodes loaded. Login with any seeded email / password "akul1234".`);
  console.log(`Demo client id: ${client.id}, hubs: BLR=${blr.id} HYD=${hyd.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
