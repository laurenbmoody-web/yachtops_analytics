// HOR Test Cases and Validation
// This file contains test scenarios to validate rolling window compliance calculations

import { addWorkEntries, getComplianceStatus, detectBreaches, BREACH_TYPES } from './horStorage';

/**
 * Test Case 1: Dayworker Schedule (07:00-19:00 daily)
 * Expected:
 * - Daily rest = 12 hours
 * - Rolling 24h rest >= 10 hours (PASS)
 * - Rolling 7d rest = 84 hours (PASS)
 */
export const testDayworkerSchedule = (crewId) => {
  console.log('\n=== TEST 1: Dayworker Schedule (07:00-19:00) ===');
  
  // Create 7 days of dayworker schedule
  const entries = [];
  const today = new Date();
  
  for (let i = 0; i < 7; i++) {
    const date = new Date(today);
    date?.setDate(date?.getDate() - i);
    const dateStr = date?.toISOString()?.split('T')?.[0];
    
    // Work from 07:00 to 19:00 (segments 14-37 = 12 hours)
    const workSegments = [];
    for (let seg = 14; seg <= 37; seg++) {
      workSegments?.push(seg);
    }
    
    entries?.push({
      date: dateStr,
      workSegments,
      workHours: 12,
      timestamp: new Date()?.toISOString()
    });
  }
  
  // Save entries
  addWorkEntries(crewId, entries);
  
  // Check compliance
  const compliance = getComplianceStatus(crewId);
  const breaches = detectBreaches(crewId);
  
  console.log('Daily rest hours:', 24 - 12, '(expected: 12)');
  console.log('Last 24h rest:', compliance?.last24HoursRest?.toFixed(1), '(expected: >= 10)');
  console.log('Last 7d rest:', compliance?.last7DaysRest?.toFixed(1), '(expected: >= 77, actual ~84)');
  console.log('Is compliant:', compliance?.isCompliant, '(expected: true)');
  console.log('Breaches found:', breaches?.length, '(expected: 0)');
  
  const passed = compliance?.isCompliant && breaches?.length === 0 && 
                 compliance?.last24HoursRest >= 10 && 
                 compliance?.last7DaysRest >= 77;
  
  console.log('TEST 1 RESULT:', passed ? '✅ PASS' : '❌ FAIL');
  return passed;
};

/**
 * Test Case 2: Split rest into 3 periods within 24h
 * Expected:
 * - Should trigger REST_PERIODS_GT_2_IN_24H breach
 */
export const testSplitRestPeriods = (crewId) => {
  console.log('\n=== TEST 2: Split Rest into 3 Periods ===');
  
  const today = new Date();
  const dateStr = today?.toISOString()?.split('T')?.[0];
  
  // Create 3 work periods with 2 rest periods in between
  // Work: 00:00-04:00 (segments 0-7), 08:00-12:00 (segments 16-23), 16:00-20:00 (segments 32-39)
  // Rest: 04:00-08:00 (4h), 12:00-16:00 (4h), 20:00-24:00 (4h) = 3 rest periods
  const workSegments = [];
  
  // Period 1: 00:00-04:00
  for (let seg = 0; seg <= 7; seg++) workSegments?.push(seg);
  // Period 2: 08:00-12:00
  for (let seg = 16; seg <= 23; seg++) workSegments?.push(seg);
  // Period 3: 16:00-20:00
  for (let seg = 32; seg <= 39; seg++) workSegments?.push(seg);
  
  const entries = [{
    date: dateStr,
    workSegments,
    workHours: 12,
    timestamp: new Date()?.toISOString()
  }];
  
  // Save entries
  addWorkEntries(crewId, entries);
  
  // Check for breaches
  const breaches = detectBreaches(crewId);
  const periodBreach = breaches?.find(b => b?.breachType === BREACH_TYPES?.REST_PERIODS_GT_2_IN_24H);
  
  console.log('Work segments:', workSegments?.length, '(12 hours work)');
  console.log('Expected rest periods: 3');
  console.log('Breaches found:', breaches?.length);
  console.log('Period breach detected:', periodBreach ? 'YES' : 'NO', '(expected: YES)');
  
  if (periodBreach) {
    console.log('Breach details:', periodBreach?.note);
  }
  
  const passed = periodBreach !== undefined;
  console.log('TEST 2 RESULT:', passed ? '✅ PASS' : '❌ FAIL');
  return passed;
};

/**
 * Test Case 3: No continuous 6h rest within 24h
 * Expected:
 * - Should trigger NO_6H_CONTINUOUS_REST_IN_24H breach
 */
export const testNoContinuous6HRest = (crewId) => {
  console.log('\n=== TEST 3: No Continuous 6h Rest ===');
  
  const today = new Date();
  const dateStr = today?.toISOString()?.split('T')?.[0];
  
  // Create work pattern with max 5.5h continuous rest
  // Work: 00:00-06:00 (6h), Rest: 06:00-11:30 (5.5h), Work: 11:30-18:00 (6.5h), Rest: 18:00-24:00 (6h)
  // But in rolling 24h, longest continuous rest is only 5.5h
  const workSegments = [];
  
  // Work: 00:00-06:00 (segments 0-11)
  for (let seg = 0; seg <= 11; seg++) workSegments?.push(seg);
  // Work: 11:30-18:00 (segments 23-35)
  for (let seg = 23; seg <= 35; seg++) workSegments?.push(seg);
  
  const entries = [{
    date: dateStr,
    workSegments,
    workHours: 12.5,
    timestamp: new Date()?.toISOString()
  }];
  
  // Save entries
  addWorkEntries(crewId, entries);
  
  // Check for breaches
  const breaches = detectBreaches(crewId);
  const continuousBreach = breaches?.find(b => b?.breachType === BREACH_TYPES?.NO_6H_CONTINUOUS_REST_IN_24H);
  
  console.log('Work hours:', 12.5);
  console.log('Rest hours:', 11.5);
  console.log('Longest continuous rest: ~5.5h (expected: < 6h)');
  console.log('Breaches found:', breaches?.length);
  console.log('Continuous rest breach detected:', continuousBreach ? 'YES' : 'NO', '(expected: YES)');
  
  if (continuousBreach) {
    console.log('Breach details:', continuousBreach?.note);
  }
  
  const passed = continuousBreach !== undefined;
  console.log('TEST 3 RESULT:', passed ? '✅ PASS' : '❌ FAIL');
  return passed;
};

/**
 * Test Case 4: 7-day short rest total < 77h
 * Expected:
 * - Should trigger REST_LT_77_IN_7D breach
 */
export const testShort7DayRest = (crewId) => {
  console.log('\n=== TEST 4: Short 7-Day Rest Total ===');
  
  // Create 7 days with 14 hours work each (10h rest per day = 70h total)
  const entries = [];
  const today = new Date();
  
  for (let i = 0; i < 7; i++) {
    const date = new Date(today);
    date?.setDate(date?.getDate() - i);
    const dateStr = date?.toISOString()?.split('T')?.[0];
    
    // Work 14 hours (segments 0-27 = 14 hours)
    const workSegments = [];
    for (let seg = 0; seg <= 27; seg++) {
      workSegments?.push(seg);
    }
    
    entries?.push({
      date: dateStr,
      workSegments,
      workHours: 14,
      timestamp: new Date()?.toISOString()
    });
  }
  
  // Save entries
  addWorkEntries(crewId, entries);
  
  // Check compliance
  const compliance = getComplianceStatus(crewId);
  const breaches = detectBreaches(crewId);
  const sevenDayBreach = breaches?.find(b => b?.breachType === BREACH_TYPES?.REST_LT_77_IN_7D);
  
  console.log('Daily work hours:', 14);
  console.log('Daily rest hours:', 10);
  console.log('Expected 7-day rest: ~70h (< 77h required)');
  console.log('Actual 7-day rest:', compliance?.last7DaysRest?.toFixed(1));
  console.log('Breaches found:', breaches?.length);
  console.log('7-day breach detected:', sevenDayBreach ? 'YES' : 'NO', '(expected: YES)');
  
  if (sevenDayBreach) {
    console.log('Breach details:', sevenDayBreach?.note);
  }
  
  const passed = sevenDayBreach !== undefined && compliance?.last7DaysRest < 77;
  console.log('TEST 4 RESULT:', passed ? '✅ PASS' : '❌ FAIL');
  return passed;
};

/**
 * Run all test cases
 */
export const runAllHORTests = (crewId = 'test-crew-001') => {
  console.log('\n╔════════════════════════════════════════════╗');
  console.log('║  HOR COMPLIANCE VALIDATION TEST SUITE     ║');
  console.log('╚════════════════════════════════════════════╝');
  
  const results = {
    test1: testDayworkerSchedule(crewId),
    test2: testSplitRestPeriods(crewId),
    test3: testNoContinuous6HRest(crewId),
    test4: testShort7DayRest(crewId)
  };
  
  const totalTests = Object.keys(results)?.length;
  const passedTests = Object.values(results)?.filter(r => r)?.length;
  
  console.log('\n╔════════════════════════════════════════════╗');
  console.log('║           TEST SUMMARY                     ║');
  console.log('╚════════════════════════════════════════════╝');
  console.log(`Total Tests: ${totalTests}`);
  console.log(`Passed: ${passedTests}`);
  console.log(`Failed: ${totalTests - passedTests}`);
  console.log(`Success Rate: ${((passedTests / totalTests) * 100)?.toFixed(0)}%`);
  
  if (passedTests === totalTests) {
    console.log('\n✅ ALL TESTS PASSED - HOR compliance calculations are correct!');
  } else {
    console.log('\n❌ SOME TESTS FAILED - Review implementation');
  }
  
  return results;
};

export default {
  testDayworkerSchedule,
  testSplitRestPeriods,
  testNoContinuous6HRest,
  testShort7DayRest,
  runAllHORTests
};