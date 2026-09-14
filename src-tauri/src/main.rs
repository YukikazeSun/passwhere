#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args().any(|argument| argument == "--verify-first-run") {
        if let Err(error) = account_notebook_lib::verify_first_run() {
            eprintln!("portable first-run verification failed: {error}");
            std::process::exit(1);
        }
        return;
    }
    account_notebook_lib::run();
}
