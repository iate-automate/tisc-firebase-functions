/**
 * Partner Schema Mappings
 *
 * Maps partner base table and field names to TISUK equivalents.
 * Partner Airtable base IDs: functions/config/settings.json → partners.*
 *
 * Structure:
 * {
 *   partnerCode: {
 *     tables: { tisukTableName: partnerTableName },
 *     fields: { tisukTableName: { tisukFieldName: partnerFieldName } }
 *   }
 * }
 */

const { partners } = require('./config/settings.json');

module.exports = {
  TIS_WALES: {
    airtableBaseId: partners.TIS_WALES.airtableBaseId,
    tables: {
      "Scheduled Courses": "Scheduled Courses",
      "Scheduled Days": "Scheduler",
      "Applications": "Enrolments",
      "People": "People",
      "Organisations": "Organisations",
      "Trainers": "Trainers"
    },
    fields: {
      "Scheduled Courses": {
        "Course ID": "Course Title",
        "Type": "TISUK Code",
        "Scheduled Days": "Scheduled Days",
        "Enrolment IDs": "Enrolment IDs"
      },
      "Scheduler": {
        "Course Day No.": "Course Day No.",
        "Date": "Date",
        "Start Time": "Start Time",
        "End Time": "End Time",
        "Online": "Online",
        "Venue": "Venue",
        "Trainers": "Trainers",
        "Trainer Emails": "Trainer Emails",
        "Trainer Booking ID's": "Trainer Booking ID's",
        "Trainer IDs": "Trainer IDs"
      },
      "Enrolments": {
        "People": "People",
        "Organisation": "Organisation",
        "Processed": "Processed",
        "Cancelled": "Cancelled",
        "Pack - Cards": "Pack - Cards",
        "Pack - Language": "Pack - Language",
        "Pack - Appendix": "Pack - Appendix",
        "Display Name": "Display Name",
        "Email": "Email",
        "Role": "Role",
        "Phone": "Phone",
        "Address Line 1": "Address Line 1",
        "Address Line 2": "Address Line 2",
        "City": "City",
        "County Council": "County Council",
        "Postcode": "Postcode"
      },
      "Organisations": {
        "Name": "Name",
        "Address Line 1": "Address Line 1",
        "Address Line 2": "Address Line 2",
        "City": "City",
        "Postcode": "Postcode",
        "County": "Council"
      },
      "People": {
        "County": "County Council"
      }
    }
  }
};

