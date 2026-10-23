//! The time stamp of a log line, as RFC 3339 in UTC with milliseconds. It is written by hand
//! because that is a few lines, and a date library is a dependency.

use std::time::{SystemTime, UNIX_EPOCH};

/// `2026-10-23T14:05:09.042Z` for `time`; the epoch for a time before it.
#[must_use]
pub fn rfc3339(time: SystemTime) -> String {
    let since = time.duration_since(UNIX_EPOCH).unwrap_or_default();
    let seconds = since.as_secs();
    let millis = since.subsec_millis();
    let (year, month, day) = civil(i64::try_from(seconds / 86_400).unwrap_or(i64::MAX / 2));
    let rest = seconds % 86_400;
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{millis:03}Z",
        rest / 3600,
        rest % 3600 / 60,
        rest % 60
    )
}

/// The date of a day counted from 1970-01-01 (Howard Hinnant's `civil_from_days`).
fn civil(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let day_of_era = z.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let shifted_month = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * shifted_month + 2) / 5 + 1;
    let month = if shifted_month < 10 {
        shifted_month + 3
    } else {
        shifted_month - 9
    };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;

    fn at(seconds: u64, millis: u32) -> String {
        rfc3339(UNIX_EPOCH + Duration::new(seconds, millis * 1_000_000))
    }

    #[test]
    fn known_instants() {
        assert_eq!(at(0, 0), "1970-01-01T00:00:00.000Z");
        assert_eq!(at(951_782_400, 0), "2000-02-29T00:00:00.000Z");
        assert_eq!(at(1_709_164_799, 999), "2024-02-28T23:59:59.999Z");
        assert_eq!(at(1_709_164_800, 5), "2024-02-29T00:00:00.005Z");
        assert_eq!(at(1_709_251_200, 0), "2024-03-01T00:00:00.000Z");
        assert_eq!(at(1_761_228_309, 42), "2025-10-23T14:05:09.042Z");
        assert_eq!(at(4_102_444_799, 0), "2099-12-31T23:59:59.000Z");
        assert_eq!(at(4_107_542_400, 0), "2100-03-01T00:00:00.000Z");
    }

    #[test]
    fn a_time_before_the_epoch_is_the_epoch() {
        assert_eq!(
            rfc3339(UNIX_EPOCH - Duration::from_secs(5)),
            "1970-01-01T00:00:00.000Z"
        );
    }
}
